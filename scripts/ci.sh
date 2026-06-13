#!/bin/sh
set -eu

make backend-test
make frontend-test
make frontend-build
