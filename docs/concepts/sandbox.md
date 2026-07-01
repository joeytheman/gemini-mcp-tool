# Sandbox Mode

Execute code safely in an isolated environment.

## What is Sandbox Mode?

Sandbox mode maps to Antigravity CLI's `--sandbox` flag, which runs with terminal restrictions enabled.

## Basic Usage

```
/ask-gemini prompt:create a Python script that sorts a list sandbox:true
```

## How It Works

1. **Request** → You ask for code to be created/tested
2. **Generation** → Gemini writes the code
3. **Execution** → Code runs in isolated environment
4. **Results** → Output returned safely

## Use Cases

### Algorithm Testing
```
/ask-gemini prompt:implement and test quicksort in JavaScript sandbox:true
```

### Data Processing
```
/ask-gemini prompt:parse this CSV and show statistics: [data] sandbox:true
```

### Proof of Concepts
```
/ask-gemini prompt:create a working web scraper example sandbox:true
```

## Safety Features

- **Terminal Restrictions**: Uses Antigravity's sandbox mode
- **Permission Controls**: Avoid `yolo` unless you explicitly want to auto-approve tool requests
- **Scoped Workspace**: Use `includeDirectories` deliberately when extra context is needed

## Supported Languages

- Python
- JavaScript/Node.js
- Ruby
- Go
- Java
- C++
- More coming soon!

## Best Practices

### 1. Be Specific
```
// Good
create a function that validates email addresses with tests

// Vague
make something that checks emails
```

### 2. Include Test Cases
```
implement binary search with edge case handling and show test results
```

### 3. Iterative Development
```
// First iteration
create a basic REST API

// Refine
add authentication to the API

// Test
show example requests and responses
```

## Limitations

- Sandbox behavior is controlled by Antigravity CLI
- Some prompts may still require permission decisions unless `yolo` is enabled
- For long tasks, use `printTimeout` to increase the `agy --print` wait time

## Examples

### Testing Algorithms
```
/ask-gemini prompt:benchmark bubble sort vs quick sort with 1000 items sandbox:true
```

### Learning Code
```
/ask-gemini prompt:show me how promises work in JavaScript with examples sandbox:true
```

### Debugging
```
/ask-gemini prompt:why does this code fail: [paste code] sandbox:true
```
