package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func mediaFixture(t testing.TB) (*App, string, string) {
	t.Helper()
	dir := t.TempDir()
	name := "video.mp4"
	data := []byte("0123456789")
	if e := os.WriteFile(filepath.Join(dir, name), data, 0600); e != nil {
		t.Fatal(e)
	}
	sum := sha256.Sum256(data)
	return &App{Config: Config{VideosPath: dir}}, name, hex.EncodeToString(sum[:])
}
func TestVerifiedLocalVideoRanges(t *testing.T) {
	a, name, digest := mediaFixture(t)
	for _, test := range []struct {
		method, rng string
		status      int
		body        string
	}{{"GET", "bytes=2-5", 206, "2345"}, {"GET", "bytes=-3", 206, "789"}, {"HEAD", "", 200, ""}, {"GET", "", 200, "0123456789"}} {
		t.Run(test.method+test.rng, func(t *testing.T) {
			r := httptest.NewRequest(test.method, "/video", nil)
			if test.rng != "" {
				r.Header.Set("Range", test.rng)
			}
			w := httptest.NewRecorder()
			if !a.serveLocalVideo(w, r, name, digest) {
				t.Fatal("matching local copy rejected")
			}
			if w.Code != test.status || w.Body.String() != test.body {
				t.Fatalf("unexpected response %d %q", w.Code, w.Body.String())
			}
			if w.Header().Get("X-Trainow-Media-Source") != "local" {
				t.Fatal("missing source diagnostic")
			}
		})
	}
}
func TestLocalVideoIntegrityAndInvalidation(t *testing.T) {
	a, name, digest := mediaFixture(t)
	r := httptest.NewRequest("GET", "/video", nil)
	if !a.serveLocalVideo(httptest.NewRecorder(), r, name, digest) {
		t.Fatal("initial verification failed")
	}
	path := filepath.Join(a.Config.VideosPath, name)
	if e := os.WriteFile(path, []byte("abcdefghij"), 0600); e != nil {
		t.Fatal(e)
	}
	future := time.Now().Add(time.Second)
	if e := os.Chtimes(path, future, future); e != nil {
		t.Fatal(e)
	}
	w := httptest.NewRecorder()
	if a.serveLocalVideo(w, r, name, digest) || w.Body.Len() != 0 {
		t.Fatal("stale local content was served")
	}
	sum := sha256.Sum256([]byte("abcdefghij"))
	if !a.serveLocalVideo(httptest.NewRecorder(), r, name, hex.EncodeToString(sum[:])) {
		t.Fatal("updated checksum rejected")
	}
}
func TestLocalVideoRejectsUnsafePaths(t *testing.T) {
	a, name, digest := mediaFixture(t)
	r := httptest.NewRequest("GET", "/video", nil)
	for _, path := range []string{"../video.mp4", "/etc/passwd", "missing.mp4"} {
		if a.serveLocalVideo(httptest.NewRecorder(), r, path, digest) {
			t.Fatal("unsafe or missing path accepted")
		}
	}
	if e := os.Symlink(filepath.Join(a.Config.VideosPath, name), filepath.Join(a.Config.VideosPath, "link.mp4")); e != nil {
		t.Fatal(e)
	}
	if a.serveLocalVideo(httptest.NewRecorder(), r, "link.mp4", digest) {
		t.Fatal("symlink accepted")
	}
}
func TestConcurrentVerifiedLocalReads(t *testing.T) {
	a, name, digest := mediaFixture(t)
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := httptest.NewRequest("GET", "/video", nil)
			r.Header.Set("Range", "bytes=0-3")
			w := httptest.NewRecorder()
			if !a.serveLocalVideo(w, r, name, digest) || w.Code != 206 || w.Body.String() != "0123" {
				t.Error("concurrent local read failed")
			}
		}()
	}
	wg.Wait()
}
func BenchmarkLocalVideoStartup(b *testing.B) {
	a, name, _ := mediaFixture(b)
	data := bytes.Repeat([]byte("fixture-video-bytes"), 16384)
	if e := os.WriteFile(filepath.Join(a.Config.VideosPath, name), data, 0600); e != nil {
		b.Fatal(e)
	}
	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])
	for _, cached := range []bool{false, true} {
		label := "ChecksumFirstRead"
		if cached {
			label = "CachedDigest"
		}
		b.Run(label, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				app := a
				if !cached {
					app = &App{Config: a.Config}
				}
				r := httptest.NewRequest("GET", "/video", nil)
				r.Header.Set("Range", "bytes=0-1023")
				if !app.serveLocalVideo(httptest.NewRecorder(), r, name, digest) {
					b.Fatal("local read failed")
				}
			}
		})
	}
}
