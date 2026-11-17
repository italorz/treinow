FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY apps/api-go/go.mod apps/api-go/go.sum ./
RUN go mod download
COPY apps/api-go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/trainow ./cmd/trainow

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/trainow /app/trainow
COPY catalog /app/catalog
COPY ["packages/acervo-videos/HD/Sem categoria", "/app/videos"]
USER nonroot:nonroot
EXPOSE 3000
ENTRYPOINT ["/app/trainow"]
CMD ["api"]
