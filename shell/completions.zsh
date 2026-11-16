# completions.zsh -- extra CLI completions, sourced by the ~/.zshrc dotfiles
# block AFTER shell/init.zsh so compinit has run (these use compdef).

if command -v opencode >/dev/null 2>&1; then
  _dotfiles_opencode_completion=$(command opencode --completions zsh 2>/dev/null)
  [[ $? == 0 && -n $_dotfiles_opencode_completion ]] && eval "$_dotfiles_opencode_completion"
  unset _dotfiles_opencode_completion
fi
