# Séance

Desktop session viewer.

## Install

```bash
brew install --cask hl/tap/seance
```

## Development

```bash
npm install
npm run tauri dev
```

## Release

Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`, then:

```bash
git tag v0.x.0 -m "v0.x.0"
git push && git push origin v0.x.0
```

CI builds the DMG and updates the Homebrew cask automatically.
