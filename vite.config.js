import { defineConfig } from 'vite'
import { execSync } from 'child_process'

function getBuildInfo() {
  const buildDate = new Date().toLocaleString() // Local timezone with time
  
  try {
    // Get recent commit info (last 2 commits)
    const gitLog = execSync('git log --oneline -2 --format="%h %ad %s" --date=format:"%m/%d %H:%M"', { 
      encoding: 'utf8' 
    }).trim().split('\n')
    
    const commits = gitLog.map(line => {
      const parts = line.split(' ')
      const hash = parts[0]
      const date = parts[1] + ' ' + parts[2] // mm/dd HH:MM
      const message = parts.slice(3).join(' ')
      // Truncate long commit messages to keep the display reasonable
      const truncatedMessage = message.length > 60 ? message.substring(0, 57) + '...' : message
      return `${hash} ${date}: ${truncatedMessage}`
    })
    
    return {
      buildTime: buildDate,
      commits: commits
    }
  } catch (error) {
    // If git is not available or not a git repo, just return build time
    return {
      buildTime: buildDate,
      commits: ['No git info available']
    }
  }
}

export default defineConfig({
  define: {
    // Inject build info at build time
    __BUILD_INFO__: JSON.stringify(getBuildInfo())
  }
})
