# Model Selection

Choose the right Gemini model for your task.

## Available Models

### Gemini-3.1-Pro-Preview
- **Best for**: Complex analysis, large codebases
- **Use when**: Analyzing entire projects, architectural reviews, stronger reasoning

### Gemini-3.1-Flash-Lite-Preview
- **Best for**: Quick responses, routine tasks, cost-efficient analysis
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

| Model | Speed | Best Use Case |
|-------|-------|---------------|
| Pro | Slower | big ideas |
| Flash Lite | Fastest | quick, specific changes |

## Cost Optimization

1. **Start with Flash Lite** for most tasks
2. **Use Pro** only when you need the full context

## Recommendations

- **Code Review**: Flash Lite
- **Architecture Analysis**: Pro
- **Quick Fixes**: Flash Lite
- **Documentation**: Flash Lite
- **Security Audit**: Pro
