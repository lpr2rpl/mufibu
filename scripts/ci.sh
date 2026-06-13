#!/bin/sh
set -eu

make ascii-check
make backend-test
make frontend-test
make frontend-build
