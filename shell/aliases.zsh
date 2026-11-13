# aliases.zsh -- general shell aliases, sourced by the ~/.zshrc managed block.
#
# Interactive file operations, so a stray rm/cp/mv can't silently clobber.
alias rm='rm -i'
alias cp='cp -i'
alias mv='mv -i'

# --color=auto: colourise matches only when writing to a terminal (safe in pipes).
alias grep='grep --color=auto'

# Coloured `ls`. GNU ls (Linux) needs --color and
# reads $LS_COLORS; BSD ls (macOS) colourises via $CLICOLOR / `-G` and $LSCOLORS.
export CLICOLOR=1
export LSCOLORS='Gxfxcxdxbxegedabagacad'
if ls --color=auto -d . >/dev/null 2>&1; then
	alias ls='ls --color=auto'
	(( $+commands[dircolors] )) && eval "$(dircolors -b)"
else
	alias ls='ls -G'
fi
