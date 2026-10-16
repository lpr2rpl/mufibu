.PHONY: all build test deb tarball clean
all: build
build:
	cargo build --release --locked
test:
	cargo test --locked
deb:
	scripts/build-deb.sh $(TARGET)
tarball: build
	mkdir -p dist
	tar czf dist/netwatch-$$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)-src.tar.gz \
	  --exclude=target --exclude=dist -C .. netwatch
clean:
	cargo clean
	rm -rf dist
