# Cite Wide Obsidian Plugin

An Obsidian plugin for rigorous, vault-wide citation management. Converts numeric footnotes into unique hex-codes, logs unique hex codes and their reference information into a base, assures consistent hex codes per reference.

## Unique Hex Code Generation

This plugin will iterate through numeric footnotes in a file or directory and convert them into unique hex-codes. The hex-codes will be logged into a base, and the footnotes will be updated to use the hex-codes. The hex-codes will be generated using a consistent algorithm that ensures the same reference always generates the same hex-code.

### Convert to Hex Modal

![Convert to Hex Modal](https://i.imgur.com/dBMKnV7.gif)

### Clean Reference Section Command

![Command: Clean Reference Section](https://i.imgur.com/usdcU1p.gif)

### Move Citations after Punctuation Command

![Move Citations after Punctuation Command](https://i.imgur.com/xbzDnPT.gif)


# Getting Started

```
pnpm install
pnpm add -D esbuild @types/node builtin-modules
pnpm build
pnpm dev
```

## Make it show up in Obsidian

Create a symbolic link into the plugins directory:

Here is my example, but you will need to use your own path structure:
```bash
ln -s /Users/mpstaton/code/lossless-monorepo/cite-wide /Users/mpstaton/content-md/lossless/.obsidian/plugins/cite-wide
```




