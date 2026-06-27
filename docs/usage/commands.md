# Commands Reference

Complete list of available commands and their usage.

## Slash Commands

### `/ask-gemini`
Analyze files or ask questions about code.

```
/ask-gemini prompt:@file.js explain this code
/ask-gemini prompt:@src/*.ts find security issues
/ask-gemini prompt:how do I implement authentication?
```

### `/ask-gemini` with `sandbox:true`
Execute code in a safe environment.

```
/ask-gemini prompt:create a Python fibonacci generator sandbox:true
/ask-gemini prompt:test this function: [code] sandbox:true
```

### `/Help`
Show help information and available tools.

```
/Help
```

### `/ping`
Test connectivity with Gemini.

```
/ping
/ping "Custom message"
```

## Command Structure

```
/ask-gemini prompt:<request> [options]
```

- **tool**: The MCP tool to call
- **options**: Optional arguments such as `model`, `sandbox`, `includeDirectories`, `printTimeout`, and `resume`
- **arguments**: Input text, files, or questions

## Natural Language Alternative

Instead of slash commands, you can use natural language:

- "Use gemini to analyze index.js"
- "Ask gemini to create a test file"
- "Have gemini explain this error"

## File Patterns

### Single File
```
@README.md
@src/index.js
@test/unit.test.ts
```

### Multiple Files
```
@file1.js @file2.js @file3.js
```

### Wildcards
```
@*.json           # All JSON files in current directory
@src/*.js         # All JS files in src
@**/*.test.js     # All test files recursively
```

### Directory
```
@src/             # All files in src
@test/unit/       # All files in test/unit
```

## Advanced Usage

### Combining Files and Questions
```
/ask-gemini prompt:@package.json @src/index.js is the entry point configured correctly?
```

### Complex Queries
```
/ask-gemini prompt:@src/**/*.js @test/**/*.test.js what's the test coverage?
```

### Code Generation
```
/ask-gemini prompt:@models/user.js generate TypeScript types for this model
```

## Tips

1. **Start Simple**: Begin with single files before using patterns
2. **Be Specific**: Clear questions get better answers
3. **Use Context**: Include relevant files for better analysis
4. **Iterate**: Refine your queries based on responses
