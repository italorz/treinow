package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"
)

func fileHash(path string) (string, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	h := sha256.New()
	if _, e = io.Copy(h, f); e != nil {
		return "", e
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func (a *App) CatalogChanged(ctx context.Context) (bool, error) {
	h, e := fileHash(a.Config.CatalogPath)
	if e != nil {
		return false, e
	}
	g, e := fileHash(a.Config.GuidancePath)
	if e != nil && !errors.Is(e, os.ErrNotExist) {
		return false, e
	}
	old, e := a.Redis.Get(ctx, "go:catalog:hash").Result()
	if e != nil && !errors.Is(e, redis.Nil) {
		return false, e
	}
	return old != h+":"+g, nil
}
func (a *App) importCatalog(ctx context.Context) error {
	h, e := fileHash(a.Config.CatalogPath)
	if e != nil {
		return e
	}
	gh, e := fileHash(a.Config.GuidancePath)
	if e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	guide := M{}
	if data, e := os.ReadFile(a.Config.GuidancePath); e == nil {
		var root M
		if e = json.Unmarshal(data, &root); e != nil {
			return e
		}
		guide = obj(root["items"])
	}
	f, e := os.Open(a.Config.CatalogPath)
	if e != nil {
		return e
	}
	defer f.Close()
	d := json.NewDecoder(f)
	token, e := d.Token()
	if e != nil || token != json.Delim('[') {
		return fmt.Errorf("invalid catalog")
	}
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(893762013)"); e != nil {
		return e
	}
	slugs := []string{}
	seen := map[string]bool{}
	for d.More() {
		var item M
		if e = d.Decode(&item); e != nil {
			return e
		}
		slug := str(item["slug"])
		if slug == "" || seen[slug] || str(obj(item["classification"])["source"]) != CatalogVersion {
			return fmt.Errorf("invalid catalog version or duplicate slug")
		}
		seen[slug] = true
		slugs = append(slugs, slug)
		video := obj(item["video"])
		variants := obj(video["variants"])
		if len(variants) == 0 {
			return fmt.Errorf("missing video variants")
		}
		if a.Config.StorageProvider == "s3" {
			for _, raw := range variants {
				v := obj(raw)
				name, key := str(v["fileName"]), str(v["objectKey"])
				if filepath.Base(name) != name || name == "" || key == "" {
					return fmt.Errorf("invalid video path")
				}
				path := filepath.Join(a.Config.VideosPath, name)
				hash, e := fileHash(path)
				if e != nil {
					return e
				}
				if hash != str(v["sha256"]) {
					return fmt.Errorf("invalid video hash")
				}
				info, e := os.Stat(path)
				if e != nil {
					return e
				}
				stat, err := a.Storage.StatObject(ctx, a.Config.Bucket, key, minio.StatObjectOptions{})
				if err != nil || stat.Size != info.Size() {
					if err != nil {
						response := minio.ToErrorResponse(err)
						if response.Code != "NoSuchKey" && response.Code != "NotFound" && response.StatusCode != 404 {
							return err
						}
					}
					_, err = a.Storage.FPutObject(ctx, a.Config.Bucket, key, path, minio.PutObjectOptions{ContentType: "video/mp4", UserMetadata: map[string]string{"sha256": hash}})
					if err != nil {
						return err
					}
				}
			}
		}
		locale, complexity := str(item["locale"]), str(item["complexity"])
		if locale == "" {
			locale = "pt-BR"
		}
		if complexity == "" {
			complexity = "iniciante"
		}
		nameRaw := str(item["nameRaw"])
		if nameRaw == "" {
			nameRaw = str(item["name"])
		}
		_, e = tx.Exec(ctx, `INSERT INTO exercises(id,slug,is_active,locale,name,name_raw,muscle_primary,secondary_muscles,equipment,complexity,movement_pattern,target_key,is_unilateral,is_stretch,is_warmup,joints,contraindications,requires_high_mind_muscle_awareness,search_tokens,classification,needs_review,video,guidance) VALUES($1,$2,true,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ON CONFLICT(slug) DO UPDATE SET is_active=true,locale=EXCLUDED.locale,name=EXCLUDED.name,name_raw=EXCLUDED.name_raw,muscle_primary=EXCLUDED.muscle_primary,secondary_muscles=EXCLUDED.secondary_muscles,equipment=EXCLUDED.equipment,complexity=EXCLUDED.complexity,movement_pattern=EXCLUDED.movement_pattern,target_key=EXCLUDED.target_key,is_unilateral=EXCLUDED.is_unilateral,is_stretch=EXCLUDED.is_stretch,is_warmup=EXCLUDED.is_warmup,joints=EXCLUDED.joints,contraindications=EXCLUDED.contraindications,requires_high_mind_muscle_awareness=EXCLUDED.requires_high_mind_muscle_awareness,search_tokens=EXCLUDED.search_tokens,classification=EXCLUDED.classification,needs_review=EXCLUDED.needs_review,video=EXCLUDED.video,guidance=EXCLUDED.guidance,updated_at=now()`, uuid.NewString(), slug, locale, str(item["name"]), nameRaw, str(item["musclePrimary"]), stringsOf(item["secondaryMuscles"]), str(item["equipment"]), complexity, str(item["movementPattern"]), str(item["targetKey"]), truth(item["isUnilateral"]), truth(item["isStretch"]), truth(item["isWarmup"]), stringsOf(item["joints"]), stringsOf(item["contraindications"]), truth(item["requiresHighMindMuscleAwareness"]), stringsOf(item["searchTokens"]), jsonBytes(item["classification"]), truth(item["needsReview"]), jsonBytes(video), jsonBytes(guide[slug]))
		if e != nil {
			return e
		}
	}
	if len(slugs) == 0 {
		return fmt.Errorf("empty catalog")
	}
	if _, e = d.Token(); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "UPDATE exercises SET is_active=false WHERE NOT(slug=ANY($1::text[]))", slugs); e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	return a.Redis.Set(ctx, "go:catalog:hash", h+":"+gh, 0).Err()
}
