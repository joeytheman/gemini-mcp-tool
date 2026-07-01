# Model Selection

Choose the right Gemini model for your task.

## Available Models

The MCP server now asks Gemini through Antigravity CLI (`agy`). The default model is:

### Gemini 3.5 Flash (Medium)
- **Best for**: Plan review, implementation critique, code review, architecture feedback
- **Use when**: You want balanced quality and latency for Codex/Claude second opinions

Other verified `agy models` Flash tiers:

- **Gemini 3.5 Flash (Low)**: faster, lower reasoning budget
- **Gemini 3.5 Flash (High)**: slower, higher reasoning budget

## Setting Models
```bash
You need use natural language: "...using gemini flash"
```
```bash
You can also pass the exact Antigravity model name in the `model` argument.
```

### Per Request
```
/ask-gemini prompt:@file.js quick review model:"Gemini 3.5 Flash (High)"
```

## Model Comparison

| Model | Speed | Best Use Case |
|-------|-------|---------------|
| Gemini 3.5 Flash (Low) | Fastest | quick, specific changes |
| Gemini 3.5 Flash (Medium) | Balanced | default review and critique |
| Gemini 3.5 Flash (High) | Slowest | deeper review and architecture feedback |

## Cost Optimization

1. **Start with Gemini 3.5 Flash (Medium)** for most tasks
2. **Use Low** for quick feedback
3. **Use High** when you want deeper critique

## Recommendations

- **Code Review**: Gemini 3.5 Flash (Medium)
- **Architecture Analysis**: Gemini 3.5 Flash (High)
- **Quick Fixes**: Gemini 3.5 Flash (Low)
- **Documentation**: Gemini 3.5 Flash (Medium)
- **Security Audit**: Gemini 3.5 Flash (High)
