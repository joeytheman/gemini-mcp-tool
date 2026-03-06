# Model Selection

Choose the right Gemini model for your task.

## Available Models

### Gemini-3.1-Pro-Preview
- **Best for**: Complex analysis, large codebases
- **Context**: 2M tokens
- **Use when**: Analyzing entire projects, architectural reviews, stronger reasoning

### Gemini-3.1-Flash-Lite-Preview
- **Best for**: Quick responses, routine tasks, cost-efficient analysis
- **Context**: 1M tokens
- **Use when**: Fast code reviews, analyzing entire projects, simple explanations
- **Note**: 2.5x faster TTFT and 45% faster output than previous Flash models

## Setting Models
```bash
You need use natural language: "...using gemini flash"
```
```bash
You can also append with '-m' or ask specifically with
```

### In Configuration
```json
{
  "mcpServers": {
    "gemini-cli": {
      "command": "gemini-mcp",
      "env": {
        "GEMINI_MODEL": "gemini-3.1-flash-lite-preview"
      }
    }
  }
}
```

### Per Request (Coming Soon)
```
/gemini-cli:analyze --model=flash @file.js quick review
```

## Model Comparison

| Model | Speed | Context | Best Use Case |
|-------|-------|---------|---------------|
| Pro | Slower | 2M tokens | big ideas |
| Flash Lite | Fastest | 1M tokens | quick, specific changes |

## Cost Optimization

1. **Start with Flash Lite** for most tasks
2. **Use Pro** only when you need the full context

## Token Limits

- **Pro**: ~2 million tokens (~500k lines of code)
- **Flash Lite**: ~1 million tokens (~250k lines of code)

## Recommendations

- **Code Review**: Flash Lite
- **Architecture Analysis**: Pro
- **Quick Fixes**: Flash Lite
- **Documentation**: Flash Lite
- **Security Audit**: Pro
