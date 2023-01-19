# `@samlior/framework` Monorepo

(◍•ᴗ•◍)

## Install

```sh
git clone https://github.com/samlior/framework
cd framework
npm install
```

## Build

```sh
npm run build -ws
```

## Test

```sh
npm run test -ws
```

### Run test for `@samlior/socket-io-server-side`

1. Run a redis service on the local port 49153, the user name must be `default`, and the password must be `redispw`. It is recommended to use docker to run.

> TODO: Maybe we need to add a method to let the outside specify.

2. Run

```sh
cd packages/socket-io-server-side && npm run test:siss
```

## TODO

- English comments
- Documentation for each package
- More tests
- ESLint, husky
