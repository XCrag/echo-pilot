function buildProviderCommand(provider, args, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform !== "win32") return { command: provider, args };

  return {
    command: env.ComSpec || env.COMSPEC || "cmd.exe",
    args: ["/d", "/s", "/c", `${provider}.cmd`, ...args],
  };
}

module.exports = { buildProviderCommand };
