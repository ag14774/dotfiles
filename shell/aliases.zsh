# aliases.zsh -- general shell aliases, sourced by the ~/.zshrc managed block.
#
# We deliberately do NOT load oh-my-zsh's `common-aliases` plugin: its global
# alias `P` ("2>&1| pygmentize -l pytb") expands inside omz_urlencode's
# `zparseopts` line whenever ~/.zshrc is re-sourced, spewing
# `omz_urlencode:5: command not found: pygmentize`. None of that plugin's
# aliases were in use -- these are the only parts worth keeping: interactive-by-
# default file ops (so a stray rm/cp/mv can't silently clobber) + colourised grep.
alias rm='rm -i'
alias cp='cp -i'
alias mv='mv -i'

# --color=auto: colourise matches only when writing to a terminal (safe in pipes).
alias grep='grep --color=auto'
