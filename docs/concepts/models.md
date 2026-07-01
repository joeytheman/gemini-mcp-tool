# Model Selection

Choose the right Gemini model for your task.

## Available Models

The MCP server now asks Gemini through Antigravity CLI (`agy`). The default model is:

### Gemini 3.1 Pro (High)
- **Best for**: Deep architecture review, large codebase analysis, security audits
- **Use when**: You want the strongest reasoning for a second opinion, regardless of latency

Other verified `agy models` tiers:

- **Gemini 3.1 Pro (Low)**: faster than Pro (High), still stronger reasoning than Flash
- **Gemini 3.5 Flash (Medium)**: balanced quality and latency, good default for routine review
- **Gemini 3.5 Flash (Low)**: fastest, lowest reasoning budget
- **Gemini 3.5 Flash (High)**: slower Flash tier, higher reasoning budget

## Setting Models

You can ask in natural language (e.g. "...using gemini flash"), or pass the exact Antigravity model name in the `model` argument.

### Per Request
```
/ask-gemini prompt:@file.js quick review model:"Gemini 3.5 Flash (Low)"
```

## Model Comparison

| Model | Speed | Best Use Case |
|-------|-------|---------------|
| Gemini 3.5 Flash (Low) | Fastest | quick, specific changes |
| Gemini 3.5 Flash (Medium) | Balanced | routine review and critique |
| Gemini 3.5 Flash (High) | Slower | deeper Flash-tier review |
| Gemini 3.1 Pro (Low) | Slower still | stronger reasoning, moderate latency |
| Gemini 3.1 Pro (High) | Slowest | default; deepest review and architecture feedback |

## Cost Optimization

1. **Start with Gemini 3.5 Flash (Medium)** for routine tasks
2. **Use Flash (Low)** for quick feedback
3. **Use a Pro tier** when you want the deepest critique, at the cost of latency

## Recommendations

- **Code Review**: Gemini 3.5 Flash (Medium)
- **Architecture Analysis**: Gemini 3.1 Pro (High)
- **Quick Fixes**: Gemini 3.5 Flash (Low)
- **Documentation**: Gemini 3.5 Flash (Medium)
- **Security Audit**: Gemini 3.1 Pro (High)
