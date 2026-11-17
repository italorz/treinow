package app

import (
	"context"
	_ "embed"

	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
)

//go:embed schema.sql
var schemaSQL string

// Migrate adds missing structures only; existing Python tables and rows remain intact.
func (a *App) Migrate(ctx context.Context) error {
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(893762011)"); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, schemaSQL); e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	m, e := rivermigrate.New(riverpgxv5.New(a.DB), nil)
	if e != nil {
		return e
	}
	_, e = m.Migrate(ctx, rivermigrate.DirectionUp, nil)
	return e
}
