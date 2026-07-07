-- ~/.config/yazi/init.lua
-- git.yazi: show each file's git status (added/modified/deleted/untracked/...)
-- as a sign in the file list, so you can see at a glance what opencode changed.
require("git"):setup {
	order = 1500,
}
