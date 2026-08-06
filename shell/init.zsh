# init.zsh -- interactive-shell framework. Replaces oh-my-zsh.
#
# Sourced early from the ~/.zshrc managed block. Sets zsh options, completion,
# and keybindings, then loads zsh-autosuggestions + starship. It does
# NOT load zsh-syntax-highlighting directly -- that must be sourced LAST (after
# every widget/keybinding), so it exposes `dotfiles_load_syntax_highlighting`
# which the managed block calls as its final line.

# ---------- history ----------
HISTFILE="$HOME/.zsh_history"
HISTSIZE=50000
SAVEHIST=50000
setopt EXTENDED_HISTORY      # write timestamps
setopt SHARE_HISTORY         # share history across live sessions
setopt HIST_IGNORE_ALL_DUPS  # collapse duplicate commands
setopt HIST_IGNORE_SPACE     # keep commands prefixed with a space out of history
setopt HIST_REDUCE_BLANKS
setopt HIST_VERIFY           # let me eyeball !-expansions before running

# ---------- directories / misc ----------
setopt AUTO_CD               # `foo/` instead of `cd foo/`
setopt AUTO_PUSHD PUSHD_IGNORE_DUPS PUSHD_SILENT
setopt INTERACTIVE_COMMENTS  # allow `# ...` comments at the prompt
setopt EXTENDED_GLOB
setopt NO_BEEP

# ---------- completion ----------
# Homebrew drops completions in share/zsh/site-functions; Arch already has its
# own on fpath. Add brew's (if present) before compinit.
() {
  local d
  for d in "${HOMEBREW_PREFIX:-/opt/homebrew}/share/zsh/site-functions" \
    /usr/local/share/zsh/site-functions; do
    [[ -d $d ]] && fpath=("$d" $fpath)
  done
}
autoload -Uz compinit && compinit
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'  # case-insensitive
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path "${XDG_CACHE_HOME:-$HOME/.cache}/zsh"
setopt COMPLETE_IN_WORD ALWAYS_TO_END

# ---------- keybindings ----------
# `bindkey -e` picks the emacs keymap as the base (Ctrl-A/Ctrl-E = start/end of
# line, Ctrl-R = reverse history search, Ctrl-K = kill to end of line, ...). The
# alternative base is `-v` (vi mode).
bindkey -e
#
# Special keys (Home, End, arrows, Delete) don't send a single byte -- they send
# a multi-byte "escape sequence" that starts with the ESC character. In these
# strings `^[` IS that ESC byte, so `^[[H` means ESC then `[` then `H` -- the
# sequence most terminals emit when you press Home. `bindkey '<sequence>' <widget>`
# says "when you receive these bytes, run this editing action (widget)".
#
# We bind each key twice for robustness: once from terminfo (the sequence THIS
# terminal declares for the key) and once with the common xterm literal, because
# some terminals/multiplexers don't fully populate terminfo.
[[ -n ${terminfo[khome]} ]] && bindkey "${terminfo[khome]}" beginning-of-line
[[ -n ${terminfo[kend]} ]] && bindkey "${terminfo[kend]}" end-of-line
[[ -n ${terminfo[kdch1]} ]] && bindkey "${terminfo[kdch1]}" delete-char
bindkey '^[[H' beginning-of-line    # Home       -> jump to start of line
bindkey '^[[F' end-of-line          # End        -> jump to end of line
bindkey '^[[3~' delete-char         # Delete     -> delete the char under the cursor
bindkey '^[[1;5C' forward-word      # Ctrl+Right -> jump one word right ( ;5 = Ctrl )
bindkey '^[[1;5D' backward-word     # Ctrl+Left  -> jump one word left
#
# Up/Down: if you've already typed something, search history for the previous/next
# command that STARTS with it (type `git ` then Up to cycle past git commands);
# with an empty line they just walk through history normally.
autoload -Uz up-line-or-beginning-search down-line-or-beginning-search
zle -N up-line-or-beginning-search
zle -N down-line-or-beginning-search
bindkey '^[[A' up-line-or-beginning-search    # Up
bindkey '^[[B' down-line-or-beginning-search  # Down
[[ -n ${terminfo[kcuu1]} ]] && bindkey "${terminfo[kcuu1]}" up-line-or-beginning-search
[[ -n ${terminfo[kcud1]} ]] && bindkey "${terminfo[kcud1]}" down-line-or-beginning-search

# ---------- helper: source the first readable file from a list ----------
dotfiles_source_first() {
  local f
  for f in "$@"; do
    [[ -r $f ]] && {
      source "$f"
      return 0
    }
  done
  return 1
}

# ---------- zsh-autosuggestions (must precede syntax-highlighting) ----------
ZSH_AUTOSUGGEST_STRATEGY=(history completion)
dotfiles_source_first \
  "${HOMEBREW_PREFIX:-/opt/homebrew}/share/zsh-autosuggestions/zsh-autosuggestions.zsh" \
  /usr/local/share/zsh-autosuggestions/zsh-autosuggestions.zsh \
  /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh

# ---------- prompt: starship ----------
(( $+commands[starship] )) && eval "$(starship init zsh)"

# ---------- zsh-syntax-highlighting loader (call LAST) ----------
# The managed block invokes this as its final line so highlighting wraps every
# widget defined above.
dotfiles_load_syntax_highlighting() {
  dotfiles_source_first \
    "${HOMEBREW_PREFIX:-/opt/homebrew}/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" \
    /usr/local/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh \
    /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
}
