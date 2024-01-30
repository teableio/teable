# @teable/electron

This is a repository in a monorepo project used to package applications into Electron desktop apps.

## Getting Started

### Install Dependencies

Run the following command in the root directory to install the dependencies:

```
yarn install
```

### Development Mode

Run the following command to start the development mode, which loads the local web application in Electron:

```
yarn start
```

> tips: Ensure that nest is start.

### Start prepare

Build all nextjs and nestjs dependent packages:

```
yarn g:build
```

Run prepare scripts

```
yarn prepare:server
```

### Building the App

Run the following command to package the application into an Electron desktop app:

- Build mac:

```
yarn make:mac
```

- Build windows:

```
yarn make:win
```

The packaged app will be generated in the `out` directory.

Debug build:

```
yarn package:debug
```

## Notes

- Make sure you have Node.js and npm installed on your local machine.
- Packaging the Electron app may take some time, please be patient.
- If you encounter any issues during the packaging process, check the console output or log files for error information.

## TODO

- [ ] Organize environment variable configuration.
- [ ] The database file can be initialized to any location.
- [ ] Optimize packing volume.
