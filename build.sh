#!/bin/bash

function check_existence {
  if ! command -v $1 &>/dev/null
  then
      echo "Command '$1' ($2) is missing"
      exit 1
  fi
}

function assert_ok {
  if [[ $? -ne 0 ]]; then
    exit 1
  fi
}

check_existence "cargo" "Rust"
check_existence "npm" "Node package manager"

function build_fp() {
  echo "Building front page"
  rm -rf static/static/dist/*
  assert_ok
  cd frontend/front_page
  npm install
  npm run build
  assert_ok
  cd ../..
}

function build_client() {
  echo "Building client"
  rm -rf static/client/*
  assert_ok
  cd frontend/client
  npm install
  npm run build
  assert_ok
  cd ../..
}

build_fp
assert_ok
build_client
assert_ok

echo "Building server"
cargo build --release --target=x86_64-unknown-linux-gnu
assert_ok

echo "Creating archive"
rm -rf target/aof
mkdir target/aof
cp target/x86_64-unknown-linux-gnu/release/aof target/aof/aof
cp -r static target/aof/
cd target
rm build.tar.gz
tar czf build.tar.gz aof/*
cd ..
rm -rf target/aof
echo "Created archive target/build.tar.gz"
