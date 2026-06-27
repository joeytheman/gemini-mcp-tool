# Real-World Examples

Practical examples of using Gemini MCP Tool in development workflows.

## Code Review

### Reviewing a Pull Request
```
/ask-gemini prompt:@feature/new-api/*.js review these changes for:
- Security issues
- Performance concerns  
- Code style consistency
- Missing error handling
```

### Pre-commit Check
```
"Gemini, check my staged changes before I commit"
```

## Debugging

### Analyzing Error Logs
```
/ask-gemini prompt:@logs/error.log @src/api/handler.js 
why am I getting "undefined is not a function" errors?
```

### Stack Trace Analysis
```
@crash-report.txt gemini, what caused this crash and how do I fix it?
```

## Architecture Analysis

### Understanding a New Codebase
```
/ask-gemini prompt:@package.json @src/**/*.js @README.md
give me an overview of this project's architecture
```

### Dependency Analysis
```
@package.json @package-lock.json are there any security vulnerabilities or outdated packages?
```

## Documentation

### Generating API Docs
```
/ask-gemini prompt:@routes/api/*.js generate OpenAPI documentation for these endpoints
```

### README Creation
```
@src/**/*.js @package.json create a comprehensive README for this project
```

## Testing

### Writing Tests
```
/ask-gemini prompt:@src/utils/validator.js write comprehensive Jest tests for this module
```

### Test Coverage Analysis
```
@src/**/*.js @test/**/*.test.js what's not being tested?
```

## Refactoring

### Code Optimization
```
/ask-gemini prompt:@src/data-processor.js this function is slow, how can I optimize it?
```

### Pattern Implementation
```
@src/services/*.js refactor these to use the Repository pattern
```

## Learning

### Understanding Concepts
```
/ask-gemini prompt:show me how OAuth 2.0 works with a working example
```

### Best Practices
```
@src/auth/*.js does this follow security best practices?
```

## Migration

### Framework Upgrade
```
/ask-gemini prompt:@package.json @src/**/*.js 
what changes are needed to upgrade from Express 4 to Express 5?
```

### Language Migration
```
@legacy/script.js convert this to TypeScript with proper types
```

## Security Audit

### Vulnerability Scan
```
/ask-gemini prompt:@src/**/*.js @package.json 
perform a security audit and identify potential vulnerabilities
```

### OWASP Check
```
@src/api/**/*.js check for OWASP Top 10 vulnerabilities
```

## Performance Analysis

### Bottleneck Detection
```
/ask-gemini prompt:@src/routes/*.js @src/middleware/*.js
identify performance bottlenecks in the request pipeline
```

### Memory Leaks
```
@src/**/*.js look for potential memory leaks or inefficient patterns
```

## Real Project Example

### Full Stack Review
```bash
# 1. Architecture overview
/ask-gemini prompt:@package.json @src/index.js @client/App.jsx 
explain how the frontend and backend connect

# 2. API Security
/ask-gemini prompt:@routes/api/*.js @middleware/auth.js 
review API security implementation

# 3. Database optimization
/ask-gemini prompt:@models/*.js @db/queries/*.sql 
suggest database optimizations

# 4. Frontend performance
/ask-gemini prompt:@client/**/*.jsx @client/**/*.css 
how can I improve frontend performance?

# 5. Test coverage
/ask-gemini prompt:@src/**/*.js @test/**/*.test.js 
what critical paths lack test coverage?
```

## Tips for Effective Usage

1. **Start Broad, Then Narrow**: Begin with overview, then dive into specifics
2. **Combine Related Files**: Include configs with source code
3. **Ask Follow-up Questions**: Build on previous responses
4. **Use Specific Criteria**: Tell Gemini what to look for
5. **Iterate on Solutions**: Refine based on suggestions