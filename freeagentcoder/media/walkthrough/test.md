# What "Test my project" runs

FreeAgentCoder looks at your project and runs the checks it already has, using your own package manager and environment:

| Project | Checks |
| --- | --- |
| Node.js / TypeScript | type check, lint, tests and build from your `package.json` scripts |
| Python (incl. ML) | `pytest`, `ruff` or `flake8`, `mypy`, or a syntax check |
| Flutter / Dart | `flutter analyze`, `flutter test` |
| Rust · Go · .NET · Java | `cargo check/test`, `go vet/test`, `dotnet build/test`, Maven or Gradle |

For web apps it can also start the dev server and check that pages load.

Every failure is explained in plain words: **what failed, why, and how to fix it**. Nothing is changed unless you ask for the fix.
