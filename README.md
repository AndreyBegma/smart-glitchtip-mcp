# smart-glitchtip-mcp

An MCP server that gives agents the full working surface of a
[GlitchTip](https://glitchtip.com) instance — issues, events, projects,
releases, alerts, uptime monitors, performance and more. Point it at an instance
URL with an API token.

> Status: design settled, implementation not started. See
> [`docs/decisions.md`](docs/decisions.md) and [`docs/roadmap.md`](docs/roadmap.md).

- NestJS + [`@rekog/mcp-nest`](https://github.com/rekog-labs/MCP-Nest)
- stdio and stateless Streamable HTTP
- read-only by default; toolsets switched on per deployment
- targets GlitchTip 6.2.6

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. Work is tracked as `FEAT-`/`BUG-` IDs and
lands on `develop`; `main` carries releases only.

## License

Apache-2.0
