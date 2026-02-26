/**
 * claw-search - Self-hosted private web search for OpenClaw
 * Using SearXNG for privacy-focused search results
 * 
 * @version 1.2.0
 * @license MIT
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

interface PluginConfig {
  baseUrl?: string;
  maxResults?: number;
  language?: string;
  safesearch?: number;
  timeout?: number;
}

interface SearchToolConfig {
  name: string;
  description: string;
  category: string;
  formatResult: (result: any, idx: number) => string;
  additionalParams?: Record<string, any>;
}

interface SearchParams {
  query: string;
  count?: number;
  category: string;
  formatResult: (result: any, idx: number) => string;
}

export default function (api: OpenClawPluginApi) {
  const pluginConfig: PluginConfig = api.config.plugins?.entries?.['openclaw-searxng-plugin']?.config || {};

  /**
   * Validate and sanitize search query
   */
  function validateQuery(query: string): string {
    if (!query || typeof query !== 'string') {
      throw new Error('Search query must be a non-empty string');
    }
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      throw new Error('Search query cannot be empty');
    }
    if (trimmed.length > 500) {
      throw new Error('Search query too long (max 500 characters)');
    }
    return trimmed;
  }

  /**
   * Build search URL with all parameters
   */
  function buildSearchUrl(params: {
    baseUrl: string;
    query: string;
    category: string;
    language: string;
    safesearch: number;
  }): string {
    const { baseUrl, query, category, language, safesearch } = params;
    
    let url = `${baseUrl.replace(/\/$/, '')}/search?` +
      `q=${encodeURIComponent(query)}&` +
      `format=json&` +
      `language=${language}`;

    // Add category if not general
    if (category !== 'general') {
      url += `&categories=${category}`;
    }

    // Add safesearch for general/news searches
    if (category === 'general' || category === 'news') {
      url += `&safesearch=${safesearch}`;
    }

    return url;
  }

  /**
   * Format search results into readable text
   */
  function formatResults(
    results: any[],
    query: string,
    formatResult: (result: any, idx: number) => string,
    data: any
  ): string {
    let text = '';

    // Add direct answer if available (prioritize for quick answers)
    if (data.answers && data.answers.length > 0) {
      const answer = typeof data.answers[0] === 'string' 
        ? data.answers[0] 
        : JSON.stringify(data.answers[0]);
      text += `💡 **Direct answer:**\n${answer}\n\n`;
    }

    // Add search results
    if (results.length === 0) {
      text += `No results found for "${query}".\n\n`;
      text += `Suggestions:\n`;
      text += `- Try different keywords\n`;
      text += `- Use more general terms\n`;
      text += `- Check spelling\n`;
      if (data.suggestions && data.suggestions.length > 0) {
        text += `\nRelated searches: ${data.suggestions.join(', ')}`;
      }
      return text;
    }

    text += `Found ${results.length} result${results.length !== 1 ? 's' : ''} for "${query}":\n\n`;
    
    results.forEach((result: any, idx: number) => {
      try {
        text += formatResult(result, idx);
      } catch (err) {
        // Skip malformed results
        console.error(`Failed to format result ${idx}:`, err);
      }
    });

    // Add suggestions if available
    if (data.suggestions && data.suggestions.length > 0) {
      text += `\n**Related searches:** ${data.suggestions.join(', ')}`;
    }

    return text;
  }

  /**
   * Generic search function - DRY principle
   * 
   * @param params - Search parameters
   * @returns Search results formatted as text
   */
  async function performSearch(params: SearchParams) {
    const { query, count, category, formatResult } = params;
    
    try {
      // Validate input
      const validatedQuery = validateQuery(query);
      
      // Get configuration with defaults
      const baseUrl = pluginConfig.baseUrl || 'http://localhost:8888';
      const maxResults = Math.min(Math.max(count || pluginConfig.maxResults || 10, 1), 100);
      const language = pluginConfig.language || 'en';
      const safesearch = pluginConfig.safesearch ?? 0;
      const timeout = (pluginConfig.timeout || 15) * 1000;

      // Build search URL
      const searchUrl = buildSearchUrl({
        baseUrl,
        query: validatedQuery,
        category,
        language,
        safesearch
      });

      // Perform search with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(searchUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'OpenClaw/openclaw-searxng-plugin/1.2.0'
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
        }

        const data: any = await response.json();
        
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid response format from SearXNG');
        }

        const results = (data.results || []).slice(0, maxResults);
        const text = formatResults(results, validatedQuery, formatResult, data);

        return {
          content: [{ type: 'text', text }]
        };

      } finally {
        clearTimeout(timeoutId);
      }

    } catch (err: any) {
      // Detailed error messages
      let errorMsg = 'Search failed: ';
      
      if (err.name === 'AbortError') {
        errorMsg += `Request timeout after ${pluginConfig.timeout || 15} seconds`;
      } else if (err.message.includes('fetch')) {
        errorMsg += `Cannot connect to SearXNG at ${pluginConfig.baseUrl || 'http://localhost:8888'}. `;
        errorMsg += 'Make sure SearXNG is running.';
      } else {
        errorMsg += err.message;
      }

      return {
        content: [{ type: 'text', text: errorMsg }],
        isError: true
      };
    }
  }

  /**
   * Create a search tool from configuration
   * 
   * @param config - Tool configuration
   * @returns Tool registration object
   */
  function createSearchTool(config: SearchToolConfig) {
    const baseParams: any = {
      type: 'object',
      properties: {
        query: { 
          type: 'string', 
          description: 'Search query (max 500 characters)'
        },
        count: { 
          type: 'number', 
          description: 'Number of results (1-100)', 
          default: 10, 
          minimum: 1, 
          maximum: 100 
        }
      },
      required: ['query']
    };

    // Merge additional parameters if provided
    if (config.additionalParams) {
      Object.assign(baseParams.properties, config.additionalParams);
    }

    return {
      name: config.name,
      description: config.description,
      parameters: baseParams,
      async execute(_id: string, params: any) {
        // Auto-enhance query for search_repos
        let query = params.query;
        if (config.name === 'search_repos' && !query.includes('site:')) {
          // Smart platform detection
          const lowerQuery = query.toLowerCase();
          if (lowerQuery.includes('gitlab')) {
            query = `${query} site:gitlab.com`;
          } else if (lowerQuery.includes('bitbucket')) {
            query = `${query} site:bitbucket.org`;
          } else {
            // Default to GitHub (most common)
            query = `${query} site:github.com`;
          }
        }
        
        return performSearch({
          query: query,
          count: params.count,
          category: config.category,
          formatResult: config.formatResult
        });
      }
    };
  }

  /**
   * Search tool configurations
   * 
   * Adding a new search type:
   * 1. Add a new object to this array
   * 2. Specify name, description, and SearXNG category
   * 3. Provide a formatResult function
   * That's it! The factory pattern handles the rest.
   */
  const searchTools: SearchToolConfig[] = [
    // General web search
    {
      name: 'search',
      description: 'Search the web using your self-hosted SearXNG instance. Returns web results from multiple search engines.',
      category: 'general',
      formatResult: (result, idx) => {
        let text = `${idx + 1}. **${result.title}**\n`;
        text += `   ${result.url}\n`;
        if (result.content) {
          const snippet = result.content.substring(0, 200);
          text += `   ${snippet}${result.content.length > 200 ? '...' : ''}\n`;
        }
        return text + '\n';
      }
    },

    // News search
    {
      name: 'search_news',
      description: 'Search for news articles. NOTE: Chinese news coverage is limited. For better Chinese news results, consider using the "search" tool instead.',
      category: 'news',
      formatResult: (result, idx) => {
        let text = `${idx + 1}. **${result.title}**\n`;
        text += `   ${result.url}\n`;
        if (result.publishedDate) {
          try {
            const date = new Date(result.publishedDate);
            text += `   📅 ${date.toLocaleDateString()}\n`;
          } catch {
            // Skip invalid dates
          }
        }
        if (result.content) {
          text += `   ${result.content.substring(0, 200)}...\n`;
        }
        return text + '\n';
      }
    },

    // Image search
    {
      name: 'search_images',
      description: 'Search for images using your SearXNG instance. Returns image URLs and metadata.',
      category: 'images',
      formatResult: (result, idx) => {
        let text = `${idx + 1}. **${result.title || 'Untitled'}**\n`;
        text += `   🖼️  ${result.img_src || result.url}\n`;
        if (result.thumbnail_src) {
          text += `   📐 Thumbnail: ${result.thumbnail_src}\n`;
        }
        if (result.url && result.url !== result.img_src) {
          text += `   🌐 Source: ${result.url}\n`;
        }
        return text + '\n';
      }
    },

    // Video search
    {
      name: 'search_videos',
      description: 'Search for videos from YouTube, Vimeo, and other platforms. Returns video URLs and metadata.',
      category: 'videos',
      formatResult: (result, idx) => {
        let text = `${idx + 1}. **${result.title}**\n`;
        text += `   🎬 ${result.url}\n`;
        if (result.thumbnail) {
          text += `   📸 Thumbnail: ${result.thumbnail}\n`;
        }
        if (result.publishedDate) {
          try {
            const date = new Date(result.publishedDate);
            text += `   📅 ${date.toLocaleDateString()}\n`;
          } catch {
            // Skip invalid dates
          }
        }
        if (result.content) {
          text += `   ${result.content.substring(0, 150)}...\n`;
        }
        return text + '\n';
      }
    },

    // Code/Repository search
    {
      name: 'search_repos',
      description: 'Search for code repositories. Automatically detects platform: GitHub (default), GitLab (if query contains "gitlab"), or Bitbucket (if query contains "bitbucket"). Site operator is added internally.',
      category: 'general',
      formatResult: (result, idx) => {
        let text = `${idx + 1}. **${result.title}**\n`;
        text += `   💻 ${result.url}\n`;
        if (result.content) {
          text += `   ${result.content.substring(0, 200)}...\n`;
        }
        return text + '\n';
      }
    },

    // Quick answer
    {
      name: 'quick_answer',
      description: 'Get a direct answer to a factual question. Best for "what is", "who is", "when did" type questions.',
      category: 'general',
      formatResult: (result, idx) => {
        let text = `${idx + 1}. ${result.title}\n`;
        text += `   ${result.url}\n`;
        if (result.content) {
          text += `   ${result.content.substring(0, 300)}...\n`;
        }
        return text + '\n';
      }
    }
  ];

  /**
   * Register all search tools
   */
  searchTools.forEach(config => {
    api.registerTool(createSearchTool(config));
  });
}
