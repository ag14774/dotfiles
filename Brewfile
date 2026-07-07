# Brewfile -- `brew bundle --file Brewfile`

# Core terminal IDE stack
brew "helix"
brew "yazi"
brew "zellij"

# Yazi preview / helper deps
brew "ffmpeg"
brew "sevenzip"
brew "poppler"
brew "imagemagick"
brew "resvg"
brew "chafa" # Unicode-block image preview; forced inside zellij (its Sixel is buggy). See yazi-picker.sh
brew "jq"
brew "fd"
brew "ripgrep"
brew "fzf"
brew "zoxide"

# Language servers / formatters (Python via ruff; TOML/Markdown/shell)
brew "ruff"
brew "taplo"
brew "marksman"
brew "shellcheck"
brew "shfmt"
brew "node" # provides npm for the JS-based LSPs (yaml/json/bash)

# Tooling
brew "uv"   # basedpyright is installed as a uv tool in install.sh
brew "stow"      # symlink manager for the config/ package
brew "git-delta" # delta: syntax-highlighted git diffs for reviewing changes (see ~/.config/git/config)
brew "glow"      # render markdown in the terminal (the `cheat` command -> CHEATSHEET.md)
brew "pandoc"    # md -> styled HTML for `cheat --pretty` (opens in the browser)
