# Model Selection

Choose the right Gemini model for your task.

## Available Models

The MCP server asks Gemini through Antigravity CLI (`agy`). Defaults depend on the tool:

| Tools | Default Model |
|-------|---------------|
| `ask-gemini`, `brainstorm` | Gemini 4 Argon (High) |
| `live-pass`, `screen-review` | Gemini 3.8 Flash (Medium) |

### Gemini 4 Argon (High)
- **Best for**: Coding, code review, architecture feedback, security audits, complex analysis, and brainstorming
- **Use when**: You want the High reasoning tier in the Gemini 4 Argon family

Other verified `agy models` tiers (checked with agy 1.3.4):

- **Gemini 4 Argon (Medium)**: Argon with a Medium reasoning budget
- **Gemini 4 Argon (Low)**: Argon with its lowest reasoning budget
- **Gemini 3.8 Flash (High)**: explicit Flash alternative for coding and complex analysis
- **Gemini 3.8 Flash (Medium)**: default for live UI passes and screen reviews; also an option for general work
- **Gemini 3.8 Flash (Low)**: lowest reasoning budget for quick, focused tasks

Some accounts also expose **Gemini 3.1 Pro (Low)** and **Gemini 3.1 Pro (High)**. Select them only when listed by `agy models`.

Model availability depends on your Antigravity CLI version and account. Run `agy models` before selecting a model. Google currently lists Argon access in Antigravity for **Google AI Ultra and Enterprise** accounts; see [model availability](https://antigravity.google/docs/models/). If Argon is missing, update Antigravity CLI and check your account's access, or explicitly choose an available Flash tier such as `Gemini 3.8 Flash (High)`. The MCP server does not automatically fall back.

See Google's [Gemini 4 Argon developer guide](https://ai.google.dev/gemini-api/docs/latest-model) and [Gemini 3.8 Flash model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) for model capabilities.

## Setting Models

You can ask in natural language (e.g. "...using gemini flash"), or pass the exact Antigravity model name in the `model` argument.

### Per Request
```
/ask-gemini prompt:@file.js review this architecture model:"Gemini 4 Argon (Medium)"
/ask-gemini prompt:@file.js quick review model:"Gemini 3.8 Flash (Low)"
```

### When Argon Is Unavailable

Choose a model that appears in `agy models`, for example:

```
/ask-gemini prompt:@file.js review this implementation model:"Gemini 3.8 Flash (High)"
/brainstorm prompt:Suggest ways to simplify this architecture model:"Gemini 3.8 Flash (High)"
```

Tiered names already encode reasoning effort. Choose the desired tier in `model` rather than adding a separate `effort` value.

## Model Comparison

| Model | Reasoning Tier | Best Use Case |
|-------|----------------|---------------|
| Gemini 4 Argon (Low) | Low | Argon with the lowest reasoning budget |
| Gemini 4 Argon (Medium) | Medium | Argon with a balanced reasoning budget |
| Gemini 4 Argon (High) | High | default for analysis and brainstorming |
| Gemini 3.8 Flash (Low) | Low | quick, specific tasks |
| Gemini 3.8 Flash (Medium) | Medium | default for live UI passes and screen reviews; general work |
| Gemini 3.8 Flash (High) | High | explicit Flash alternative for coding and complex analysis |
| Gemini 3.1 Pro (Low) | Low | explicitly selected Pro-family tasks, when available |
| Gemini 3.1 Pro (High) | High | explicitly selected Pro-family tasks, when available |

## Cost Optimization

1. **Choose a Flash tier explicitly** when you prefer it or Argon is unavailable
2. **Use Gemini 3.8 Flash (Medium)** for balanced general work
3. **Use Gemini 3.8 Flash (Low)** for quick feedback
4. **Choose an Argon tier explicitly** to adjust its reasoning budget

## Recommendations

- **Code Review**: Gemini 4 Argon (High)
- **Architecture Analysis**: Gemini 4 Argon (High)
- **Brainstorming**: Gemini 4 Argon (High)
- **Live UI Passes and Screen Reviews**: Gemini 3.8 Flash (Medium)
- **Quick Fixes**: Gemini 3.8 Flash (Low)
- **Documentation**: Gemini 3.8 Flash (Medium)
- **Security Audit**: Gemini 4 Argon (High)
