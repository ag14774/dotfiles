--- @since 26.8.15
-- git-branch.yazi: mark the files this branch changed in its commits since it
-- left the remote's default branch (from its merge base with origin/HEAD, as in
-- the Alt-v review), next to git.yazi's marks for uncommitted changes. Same
-- signs as git.yazi, in their own colour. Modelled on git.yazi (yazi-rs/plugins).

-- Higher codes win when a directory holds several kinds of change.
local CODES = { clean = 0, deleted = 1, added = 2, modified = 3 }
local SIGNS = {
	[CODES.deleted] = "\u{F458} ",
	[CODES.added] = "\u{F457} ",
	[CODES.modified] = "\u{F459} ",
}

---@param cwd Url
---@return string?
local function root(cwd)
	local is_worktree = function(url)
		local file, head = io.open(tostring(url)), nil
		if file then
			head = file:read(8)
			file:close()
		end
		return head == "gitdir: "
	end

	repeat
		local next = cwd:join(".git")
		local stat = fs.cha(next)
		if stat and (stat.is_dir or is_worktree(next)) then
			return tostring(cwd)
		end
		cwd = cwd.parent
	until not cwd
end

local function retry(job)
	return ya.co(function()
		for _, file in ipairs(job.files) do
			coroutine.yield(file, { retry = true })
		end
	end)
end

local add = ya.sync(function(st, cwd, repo, changed)
	st.dirs[cwd] = repo
	st.repos[repo] = st.repos[repo] or {}
	for path, code in pairs(changed) do
		st.repos[repo][path] = code ~= CODES.clean and code or nil
	end
	ui.render()
end)

local remove = ya.sync(function(st, cwd)
	local repo = st.dirs[cwd]
	if not repo then
		return
	end

	ui.render()
	st.dirs[cwd] = nil
	for _, r in pairs(st.dirs) do
		if r == repo then
			return
		end
	end
	st.repos[repo] = nil
end)

local function setup(st, opts)
	st.dirs = {}
	st.repos = {}

	opts = opts or {}
	local style = ui.Style():fg(opts.color or "blue")

	Linemode:children_add(function(self)
		if not self._file.in_current then
			return ""
		end

		local url = self._file.url
		local repo = st.dirs[tostring(url.base or url.parent)]
		local code = repo and st.repos[repo] and st.repos[repo][tostring(url):sub(#repo + 2)]
		local sign = code and SIGNS[code]
		if not sign then
			return ""
		elseif self._file.is_hovered then
			return ui.Line { " ", sign }
		else
			return ui.Line { " ", ui.Span(sign):style(style) }
		end
	end, opts.order or 1450)
end

local function fetch(_, job)
	local cwd = job.files[1].url.base or job.files[1].url.parent
	local repo = root(cwd)
	if not repo then
		remove(tostring(cwd))
		return require("noop"):fetch(job)
	end

	-- Paths relative to the repository, from the merge base to HEAD; nothing
	-- without origin/HEAD or new commits.
	-- stylua: ignore
	local output, err = Command("git")
		:cwd(repo)
		:arg({ "--no-optional-locks", "-c", "core.quotePath=", "diff", "--name-status", "-z", "--no-renames",
			"--merge-base", "origin/HEAD", "HEAD" })
		:output()
	if not output then
		ya.err("Cannot spawn `git` command, error: " .. err)
		return require("noop"):fetch(job)
	end

	local branch = {}
	for status, path in output.stdout:gmatch("([^\0]+)\0([^\0]+)\0") do
		local code = status == "A" and CODES.added or status == "D" and CODES.deleted or CODES.modified
		branch[path] = code
		local dir = path:match("^(.+)/[^/]+$")
		while dir do
			branch[dir] = math.max(branch[dir] or CODES.clean, code)
			dir = dir:match("^(.+)/[^/]+$")
		end
	end

	local changed = {}
	for _, file in ipairs(job.files) do
		local path = tostring(file.url):sub(#repo + 2)
		changed[path] = branch[path] or CODES.clean
	end
	add(tostring(cwd), repo, changed)

	return retry(job)
end

return { setup = setup, fetch = fetch }
