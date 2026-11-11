-- ~/.config/yazi/init.lua
-- git.yazi: show each file's git status (added/modified/deleted/untracked/...)
-- as a sign in the file list, so you can see at a glance what opencode changed.
require("git"):setup {
	order = 1500,
}
-- git-branch.yazi (local: plugins/git-branch.yazi): the same signs in blue, left
-- of git.yazi's, for what this branch's commits changed since it left
-- origin/HEAD. Together they cover what the Alt-v review shows.
require("git-branch"):setup {
	order = 1450,
	color = "blue",
}
