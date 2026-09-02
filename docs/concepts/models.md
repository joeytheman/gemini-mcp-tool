# Model Selection

Choose the right Gemini model for your task.

## Available Models

The MCP server asks Gemini through Antigravity CLI (`agy`). The default model is:

### Gemini 3.8 Flash (High)
- **Best for**: Coding, code review, architecture feedback, security audits, and complex analysis
- **Use when**: You want the largest reasoning budget in the Gemini 3.8 Flash family

Other verified `agy models` tiers:

- **Gemini 3.8 Flash (Medium)**: balanced reasoning and latency for general work
- **Gemini 3.8 Flash (Low)**: lowest reasoning budget for quick, focused tasks
- **Gemini 3.1 Pro (Low)**: explicit Pro-family alternative
- **Gemini 3.1 Pro (High)**: explicit Pro-family alternative with a higher reasoning budget

Model availability depends on your Antigravity CLI version and account. Run `agy models` before selecting a model. If Gemini 3.8 Flash is missing, update Antigravity CLI, rerun `agy install`, and explicitly choose an available model such as `Gemini 3.1 Pro (High)`. The MCP server does not automatically fall back.

See Google's [Gemini 3.8 Flash model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) for model capabilities.

## Setting Models

You can ask in natural language (e.g. "...using gemini flash"), or pass the exact Antigravity model name in the `model` argument.

### Per Request
```
/ask-gemini prompt:@file.js quick review model:"Gemini 3.8 Flash (Low)"
```

## Model Comparison

| Model | Reasoning Tier | Best Use Case |
|-------|----------------|---------------|
| Gemini 3.8 Flash (Low) | Low | quick, specific tasks |
| Gemini 3.8 Flash (Medium) | Medium | balanced general work and documentation |
| Gemini 3.8 Flash (High) | High | default; coding and complex analysis |
| Gemini 3.1 Pro (Low) | Low | explicitly selected Pro-family tasks |
| Gemini 3.1 Pro (High) | High | explicitly selected Pro-family tasks |

## Cost Optimization

1. **Use Gemini 3.8 Flash (High)** for coding and complex analysis
2. **Use Gemini 3.8 Flash (Medium)** for balanced general work
3. **Use Gemini 3.8 Flash (Low)** for quick feedback
4. **Choose a Pro tier explicitly** when it better fits your task or 3.8 is unavailable

## Recommendations

- **Code Review**: Gemini 3.8 Flash (High)
- **Architecture Analysis**: Gemini 3.8 Flash (High)
- **Quick Fixes**: Gemini 3.8 Flash (Low)
- **Documentation**: Gemini 3.8 Flash (Medium)
- **Security Audit**: Gemini 3.8 Flash (High)
