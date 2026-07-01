# Troubleshooting

Common issues and their solutions. Click any issue below to see the detailed solution.

This MCP server now asks Gemini through Antigravity CLI (`agy`). The retired Gemini CLI/API path is not used.

<script setup>
import TroubleshootingModal from '../.vitepress/components/TroubleshootingModal.vue'
</script>

## Installation Issues

<TroubleshootingModal 
  title='"Antigravity CLI (`agy`) was not found"'
  preview="Antigravity CLI is not installed or not in your PATH"
>

Antigravity CLI is not installed or is not on your PATH. Configure it first:
```bash
agy install
```

After installation, verify it works:
```bash
agy --version
agy models
```

If you still get "command not found", restart your terminal and verify the directory containing `agy` is on your PATH.

</TroubleshootingModal>

<TroubleshootingModal 
  title="Windows NPX Installation Issues"
  preview='Error: unknown option "-y" when using Claude Code on Windows'
>

**Problem**: `error: unknown option '-y'` when using Claude Code on Windows

**Solution**: Use one of these alternative installation methods:

```bash
# Method 1: Install globally first
npm install -g @joeytheman/gemini-mcp-tool
claude mcp add gemini-feedback -- gemini-mcp

# Method 2: Use --yes instead of -y
claude mcp add gemini-feedback -- npx --yes @joeytheman/gemini-mcp-tool

# Method 3: Remove the -y flag entirely
claude mcp add gemini-feedback -- npx @joeytheman/gemini-mcp-tool
```

</TroubleshootingModal>

<TroubleshootingModal 
  title='"MCP server not responding"'
  preview="Claude Desktop can't connect to the MCP server"
>

**Step-by-step solution**:

1. **Check your Claude Desktop config file location**
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. **Verify JSON syntax is correct**
   - Use a JSON validator online
   - Check for missing commas, brackets, or quotes

3. **Restart Claude Desktop completely**
   - Quit completely (Cmd+Q on Mac)
   - Wait 5 seconds
   - Restart Claude Desktop

4. **Check logs for detailed errors**
   - macOS: `~/Library/Logs/Claude/`
   - Windows: `%APPDATA%\Claude\logs\`

</TroubleshootingModal>

## Connection Issues

<TroubleshootingModal 
  title='"Failed to connect to Gemini"'
  preview="Antigravity CLI connection or authentication problems"
>

**Step-by-step solution**:

1. **Verify Antigravity CLI works outside the MCP server**:
   ```bash
   agy --version
   agy models
   ```

2. **Check your internet connection**
   - Try accessing google.com in your browser
   - Test with a simple request: `agy --model "Gemini 3.5 Flash (Medium)" --print "test"`

3. **Verify firewall settings**
   - Ensure your firewall isn't blocking requests to Google APIs
   - Check corporate proxy settings if applicable

4. **Test basic connectivity**:
   ```bash
   /ping "test"
   ```

5. **If still failing, re-run Antigravity setup**
   ```bash
   agy install
   ```

</TroubleshootingModal>

<TroubleshootingModal 
  title='"Timeout errors"'
  preview="Requests taking too long or timing out"
>

**Common causes and solutions**:

1. **Large files naturally take time** - Be patient with large file analysis

2. **Use a faster Gemini Flash tier**:
   ```bash
   /ask-gemini prompt:"quick review this change" model:"Gemini 3.5 Flash (Low)"
   ```

3. **Break up large requests into smaller chunks**:
   ```bash
   # Instead of analyzing entire file
   /ask-gemini prompt:@large-file.js explain the main function
   
   # Target specific sections
   /ask-gemini prompt:@large-file.js explain lines 50-100
   ```

4. **For very large codebases, the tool prevents timeouts automatically**:
   - Progress updates keep the connection alive
   - Clear status messages show processing is active
   - No manual configuration needed

</TroubleshootingModal>

<TroubleshootingModal 
  title='"MCP error -32000: Connection closed"'
  preview="Server fails to start and connection closes immediately (Claude Code)"
>

**Common causes**:

1. **Node.js version compatibility** - Ensure Node.js >= v18.0.0
2. **Antigravity CLI not installed** - Run `agy install` and verify `agy --version`
3. **Antigravity authentication/setup incomplete** - Run `agy models` and complete any prompts
4. **PATH issues** - Restart terminal after installing Node.js/npm

**Debug steps**:

```bash
# 1. Check Node.js version
node --version

# 2. Test Antigravity CLI directly
agy --model "Gemini 3.5 Flash (Medium)" --print "Hello"

# 3. Reinstall if needed
npm uninstall -g @joeytheman/gemini-mcp-tool
npm install -g @joeytheman/gemini-mcp-tool

# 4. Verify Claude Code can find the command
claude mcp list
```

**Still not working?** Check the Claude Desktop logs for detailed error messages:
- macOS: `~/Library/Logs/Claude/`
- Windows: `%APPDATA%\Claude\logs\`

</TroubleshootingModal>

### "Gemini gets cut off" / Early Termination
**Problem**: Responses appear truncated or Claude reports "Gemini was thinking but got cut off"

**Causes**:
- Large codebase analysis taking longer than expected
- Complex operations requiring extended processing time
- Client connection management issues

**Solutions**:
```bash
# The tool automatically prevents timeouts with progress updates
# You'll see messages like:
# "🔍 Starting analysis (may take 5-15 minutes for large codebases)"
# "🧠 Gemini is analyzing your request..."

# Use faster Flash model for large requests
/ask-gemini prompt:@large-file.js summarize model:"Gemini 3.5 Flash (Low)"

# Break up large analysis into smaller chunks
/ask-gemini prompt:@specific-function.js explain this function
```

## File Analysis Issues

### "File not found"
- Use absolute paths when possible
- Check file permissions
- Verify working directory

### "Token limit exceeded" / "Response exceeds maximum allowed tokens"
**Problem**: Response exceeds the maximum allowed token limit

**Solutions**:
```bash
# Use Flash Low for faster, shorter responses
/ask-gemini prompt:"your prompt" model:"Gemini 3.5 Flash (Low)"

# Break large requests into smaller, focused chunks
/ask-gemini prompt:@file1.js explain the main function
/ask-gemini prompt:@file2.js explain the error handling
```

## Configuration Issues

### Changes not taking effect
1. Save config file
2. Completely quit Claude Desktop
3. Restart Claude Desktop
4. Verify with `/Help`

### Environment variables not working
```bash
# Check current settings
echo $AGY_CACHE_ENABLED
agy models
```

### Configurable Timeout for Large Codebases
**Problem**: Default MCP client timeout too short for large analysis

**Root Cause**: Claude Desktop/Claude Code has a hard-coded timeout that cannot be overridden by environment variables.

**Solution**: The tool now automatically sends progress updates to prevent timeouts
```bash
# The tool will automatically send progress messages like:
# "🔍 Starting analysis (may take 5-15 minutes for large codebases)"
# "🧠 Gemini is analyzing your request..."
# "📊 Processing files and generating insights..."
# "⏳ Still processing... Gemini is working on your request"
```

**What happens during long operations**:
- Progress updates every 25 seconds during active processing
- Backup heartbeat every 20 seconds to ensure connection stays alive
- Clear status messages showing the tool is working
- Automatic completion notification when done

**For very large codebases** (10,000+ files):
- Consider breaking analysis into smaller chunks
- Use more specific file patterns with `@` syntax
- Use `Gemini 3.5 Flash (Low)` for faster processing
```

## Debugging

The old Gemini CLI `debug` option is no longer supported. Use MCP client logs plus Antigravity CLI output:

```bash
agy --help
agy models
agy changelog
```

## Getting Help

1. Check [GitHub Issues](https://github.com/joeytheman/gemini-mcp-tool/issues)
2. Collect Antigravity and MCP client logs
3. Open a new issue with details

## Model Recommendations

| **Use Case** | **Recommended Model** | **Reason** |
|--------------|----------------------|------------|
| Complex analysis | `Gemini 3.1 Pro (High)` | Deepest review (default) |
| Architecture review | `Gemini 3.1 Pro (High)` | Best for large codebases |
| Quick tasks | `Gemini 3.5 Flash (Low)` | Fastest responses |
| Code review | `Gemini 3.5 Flash (Medium)` | Good speed/quality balance |

## Quick Fixes

### Reset Everything
```bash
# Remove and reinstall
npm uninstall -g @joeytheman/gemini-mcp-tool
npm install -g @joeytheman/gemini-mcp-tool

# Refresh Antigravity CLI setup
agy install
agy models
```

### Test Basic Functionality
```bash
# Test Antigravity CLI
agy --model "Gemini 3.5 Flash (Medium)" --print "Hello"

# Test MCP Tool
/ping

# Test file analysis with working model
/ask-gemini prompt:@README.md summarize model:"Gemini 3.5 Flash (Medium)"
```

## Platform-Specific Issues

### Windows 11
- **NPX flag issues**: Use `--yes` instead of `-y`
- **Path problems**: Restart terminal after Node.js installation
- **Connection issues**: Ensure Windows Defender isn't blocking Node.js

### macOS
- **Permission issues**: Use `sudo` if npm install fails
- **Terminal restart**: Required after installing dependencies

### Linux
- **Node.js version**: Install via NodeSource for latest version
- **npm permissions**: Configure npm to avoid sudo usage
