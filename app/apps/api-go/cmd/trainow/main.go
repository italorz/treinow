package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/italorz/treinow/apps/api-go/internal/app"
)

func main() {
	if e := run(); e != nil {
		slog.Error("trainow stopped", "error", e)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		c := &http.Client{Timeout: 3 * time.Second}
		r, e := c.Get("http://127.0.0.1:3000/health")
		if e != nil {
			return e
		}
		defer r.Body.Close()
		if r.StatusCode != 200 {
			return errors.New("unhealthy API")
		}
		return nil
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	config, e := app.LoadConfig()
	if e != nil {
		return e
	}
	a, e := app.Open(ctx, config)
	if e != nil {
		return e
	}
	defer a.Close()
	mode := "api"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	if mode != "api" && mode != "worker" && mode != "migrate" {
		return errors.New("expected api, worker or migrate")
	}
	if mode != "worker" {
		if e = a.Migrate(ctx); e != nil {
			return e
		}
	}
	if mode == "migrate" {
		return nil
	}
	if mode == "api" {
		if e = a.EnsureStorage(ctx); e != nil {
			return e
		}
	}
	worker := mode == "worker"
	if e = a.InitQueue(worker); e != nil {
		return e
	}
	if worker {
		if e = a.Queue.Start(ctx); e != nil {
			return e
		}
		changed, e := a.CatalogChanged(ctx)
		if e != nil {
			return e
		}
		if changed {
			if e = a.ImportOnStart(ctx); e != nil {
				return e
			}
		}
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return a.Queue.Stop(shutdown)
	}
	server := &http.Server{Addr: ":" + config.Port, Handler: a.Router(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	done := make(chan error, 1)
	go func() { slog.Info("trainow api ready", "port", config.Port); done <- server.ListenAndServe() }()
	select {
	case e = <-done:
		if errors.Is(e, http.ErrServerClosed) {
			return nil
		}
		return e
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
