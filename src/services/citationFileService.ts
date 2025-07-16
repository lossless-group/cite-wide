import { App, TFile, Notice } from 'obsidian';

export interface CitationMetadata {
    hexId: string;
    title: string | undefined;
    author: string | undefined;
    url: string | undefined;
    date: string | undefined;
    source: string | undefined;
    tags: string[];
    created: string;
    lastModified: string;
    referenceText: string | undefined;
    usageCount: number;
    filesUsedIn: string[];
}

export class CitationFileService {
    private app: App;
    private citationsFolder: string = 'Citations';

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Set the citations folder path
     */
    public setCitationsFolder(folderPath: string): void {
        this.citationsFolder = folderPath;
    }

    /**
     * Get the citations folder path
     */
    public getCitationsFolder(): string {
        return this.citationsFolder;
    }

    /**
     * Create a citation file with citation data directly from Jina.ai
     */
    public async createCitationFileWithData(
        hexId: string,
        citationData: any,
        sourceFile?: string
    ): Promise<TFile | null> {
        try {
            // Check if app is initialized
            if (!this.app) {
                console.error('CitationFileService not initialized with app instance');
                return null;
            }

            // Ensure citations folder exists
            console.log('Creating citation file with data:', hexId, citationData);
            await this.ensureCitationsFolder();

            // Generate filename
            const filename = `${hexId}.md`;
            const filepath = `${this.citationsFolder}/${filename}`;

            // Check if file already exists and delete it to overwrite
            const existingFile = this.app.vault.getAbstractFileByPath(filepath);
            if (existingFile instanceof TFile) {
                await this.app.vault.delete(existingFile);
                console.log(`Deleted existing citation file to overwrite: ${filename}`);
            }

            // Create frontmatter directly from citation data
            const frontmatter = this.createFrontmatterFromData(hexId, citationData, sourceFile || '');

            // Create file content
            const content = this.createFileContent(frontmatter);

            // Create the file
            const file = await this.app.vault.create(filepath, content);
            
            if (file instanceof TFile) {
                new Notice(`Citation file created: ${filename}`);
                return file;
            }

            return null;
        } catch (error) {
            console.error('Error creating citation file:', error);
            new Notice(`Error creating citation file: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Create a citation file with frontmatter metadata
     */
    public async createCitationFile(
        hexId: string, 
        referenceText?: string, 
        url?: string,
        sourceFile?: string
    ): Promise<TFile | null> {
        try {
            // Check if app is initialized
            if (!this.app) {
                console.error('CitationFileService not initialized with app instance');
                return null;
            }

            // Ensure citations folder exists
            console.log('Creating citation file:', hexId, referenceText, url, sourceFile);
            await this.ensureCitationsFolder();

            // Generate filename
            const filename = `${hexId}.md`;
            const filepath = `${this.citationsFolder}/${filename}`;

            // Check if file already exists
            const existingFile = this.app.vault.getAbstractFileByPath(filepath);
            if (existingFile instanceof TFile) {
                // Update existing file with new usage
                await this.updateCitationUsage(existingFile, sourceFile);
                return existingFile;
            }

            // Extract metadata from reference text
            const metadata = this.extractMetadataFromReference(referenceText, url);

            // Create frontmatter
            const frontmatter = this.createFrontmatter(hexId, metadata, sourceFile || '');

            // Create file content
            const content = this.createFileContent(frontmatter, referenceText);

            // Create the file
            const file = await this.app.vault.create(filepath, content);
            
            if (file instanceof TFile) {
                new Notice(`Citation file created: ${filename}`);
                return file;
            }

            return null;
        } catch (error) {
            console.error('Error creating citation file:', error);
            new Notice(`Error creating citation file: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Update citation usage when it's used in another file
     */
    public async updateCitationUsage(citationFile: TFile, sourceFile?: string): Promise<void> {
        try {
            const content = await this.app.vault.read(citationFile);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            
            if (!frontmatterMatch || !frontmatterMatch[1]) {
                return;
            }

            const frontmatter = frontmatterMatch[1];
            const metadata = this.parseFrontmatter(frontmatter);
            
            // Update usage count
            metadata.usageCount = (Number(metadata.usageCount) || 0) + 1;
            metadata.lastModified = new Date().toISOString();

            // Add source file if provided and not already included
            if (sourceFile && metadata.filesUsedIn) {
                if (!metadata.filesUsedIn.includes(sourceFile)) {
                    metadata.filesUsedIn.push(sourceFile);
                }
            } else if (sourceFile) {
                metadata.filesUsedIn = [sourceFile];
            }

            // Create new frontmatter - ensure we have required fields
            const completeMetadata: CitationMetadata = {
                hexId: metadata.hexId || '',
                title: metadata.title,
                author: metadata.author,
                url: metadata.url,
                date: metadata.date,
                source: metadata.source,
                tags: metadata.tags || [],
                created: metadata.created || new Date().toISOString(),
                lastModified: metadata.lastModified || new Date().toISOString(),
                referenceText: metadata.referenceText,
                usageCount: metadata.usageCount || 0,
                filesUsedIn: metadata.filesUsedIn || []
            };
            
            const newFrontmatter = this.createFrontmatterString(completeMetadata);
            
            // Replace frontmatter in content
            const newContent = content.replace(/^---\n[\s\S]*?\n---/, newFrontmatter);
            
            await this.app.vault.modify(citationFile, newContent);
        } catch (error) {
            console.error('Error updating citation usage:', error);
        }
    }

    /**
     * Extract metadata from reference text
     */
    private extractMetadataFromReference(referenceText?: string, url?: string): Partial<CitationMetadata> {
        const metadata: Partial<CitationMetadata> = {};

        if (url) {
            metadata.url = url;
            
            // Try to extract title from URL
            try {
                const urlObj = new URL(url);
                const hostname = urlObj.hostname;
                if (hostname) {
                    metadata.source = hostname;
                }
            } catch (e) {
                // Invalid URL, ignore
            }
        }

        if (referenceText) {
            // Try to extract title from markdown link format: [title](url)
            // Skip citation references like [^hexId] and look for actual content links
            const titleMatch = referenceText.match(/\[([^\]^]+)\]\s*\(https?:\/\/[^\s]+\)/);
            if (titleMatch) {
                metadata.title = titleMatch[1];
            }

            // Try to extract author (common patterns)
            const authorPatterns = [
                /by\s+([^,\.]+)/i,
                /author[:\s]+([^,\.]+)/i,
                /written\s+by\s+([^,\.]+)/i
            ];

            for (const pattern of authorPatterns) {
                const match = referenceText.match(pattern);
                if (match && match[1]) {
                    metadata.author = match[1].trim();
                    break;
                }
            }

            // Try to extract date
            const datePatterns = [
                /(\d{4})/,
                /(\d{1,2}\/\d{1,2}\/\d{4})/,
                /(\d{1,2}-\d{1,2}-\d{4})/
            ];

            for (const pattern of datePatterns) {
                const match = referenceText.match(pattern);
                if (match) {
                    metadata.date = match[1];
                    break;
                }
            }
        }

        return metadata;
    }

    /**
     * Create frontmatter object from citation data
     */
    private createFrontmatterFromData(
        hexId: string,
        citationData: any,
        sourceFile: string
    ): CitationMetadata {
        const now = new Date().toISOString();
        
        return {
            hexId,
            title: citationData.title || undefined,
            author: citationData.author || undefined,
            url: citationData.url || undefined,
            date: citationData.date || undefined,
            source: citationData.siteName || undefined,
            tags: [],
            created: now,
            lastModified: now,
            referenceText: undefined,
            usageCount: 1,
            filesUsedIn: sourceFile ? [sourceFile] : []
        };
    }

    /**
     * Create frontmatter object
     */
    private createFrontmatter(
        hexId: string, 
        metadata: Partial<CitationMetadata>, 
        sourceFile: string
    ): CitationMetadata {
        const now = new Date().toISOString();
        
        return {
            hexId,
            title: metadata.title || undefined,
            author: metadata.author || undefined,
            url: metadata.url || undefined,
            date: metadata.date || undefined,
            source: metadata.source || undefined,
            tags: metadata.tags || [],
            created: now,
            lastModified: now,
            referenceText: metadata.referenceText || undefined,
            usageCount: 1,
            filesUsedIn: sourceFile ? [sourceFile] : []
        };
    }

    /**
     * Create frontmatter string
     */
    private createFrontmatterString(metadata: CitationMetadata): string {
        const lines = ['---'];
        
        // Add all metadata fields
        Object.entries(metadata).forEach(([key, value]) => {
            if (key && value !== undefined && value !== null) {
                if (Array.isArray(value)) {
                    if (value.length > 0) {
                        lines.push(`${key}:`);
                        value.forEach(item => lines.push(`  - ${item}`));
                    }
                } else {
                    // Ensure hexId is always written as a string to prevent YAML from interpreting it as a number
                    if (key === 'hexId') {
                        lines.push(`${key}: "${value}"`);
                    } else {
                        lines.push(`${key}: ${value}`);
                    }
                }
            }
        });
        
        lines.push('---');
        return lines.join('\n');
    }

    /**
     * Parse frontmatter string
     */
    private parseFrontmatter(frontmatter: string): Partial<CitationMetadata> {
        const metadata: Partial<CitationMetadata> = {};
        const lines = frontmatter.split('\n');
        
        let currentKey: string | null = null;
        let currentArray: string[] = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            if (trimmed.startsWith('- ')) {
                // Array item
                if (currentKey && currentArray) {
                    currentArray.push(trimmed.substring(2));
                }
            } else if (trimmed.includes(':')) {
                // Save previous array if exists
                if (currentKey && currentArray.length > 0) {
                    (metadata as any)[currentKey] = currentArray;
                    currentArray = [];
                }
                
                // New key-value pair
                const [key, ...valueParts] = trimmed.split(':');
                let value = valueParts.join(':').trim();
                
                // Remove quotes from value
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.slice(1, -1);
                }
                
                if (value && key) {
                    (metadata as any)[key.trim()] = value;
                } else if (key) {
                    currentKey = key.trim();
                    currentArray = [];
                }
            }
        }
        
        // Save final array if exists
        if (currentKey && currentArray.length > 0) {
            (metadata as any)[currentKey] = currentArray;
        }
        
        return metadata;
    }

    /**
     * Create file content with frontmatter and reference text
     */
    private createFileContent(frontmatter: CitationMetadata, referenceText?: string): string {
        const frontmatterString = this.createFrontmatterString(frontmatter);
        
        let content = frontmatterString + '\n\n';
        
        if (referenceText) {
            content += `# ${frontmatter.title || 'Citation'}\n\n`;
            content += `## Reference\n\n${referenceText}\n\n`;
        } else {
            content += `# Citation ${frontmatter.hexId}\n\n`;
        }
        
        content += `## Usage\n\nThis citation has been used ${frontmatter.usageCount} time(s).\n\n`;
        
        if (frontmatter.url) {
            content += `## Source\n\n[${frontmatter.url}](${frontmatter.url})\n\n`;
        }
        
        content += `## Notes\n\nAdd your notes about this citation here.\n\n`;
        
        return content;
    }

    /**
     * Ensure citations folder exists
     */
    private async ensureCitationsFolder(): Promise<void> {
        if (!this.app) {
            throw new Error('CitationFileService not initialized with app instance');
        }
        
        const folder = this.app.vault.getAbstractFileByPath(this.citationsFolder);
        
        if (!folder) {
            await this.app.vault.createFolder(this.citationsFolder);
        }
    }

    /**
     * Get all citation files
     */
    public async getAllCitationFiles(): Promise<TFile[]> {
        const folder = this.app.vault.getAbstractFileByPath(this.citationsFolder);
        if (!folder) {
            return [];
        }

        const files: TFile[] = [];
        const processFolder = (folder: any) => {
            if (folder.children) {
                folder.children.forEach((child: any) => {
                    if (child instanceof TFile && child.extension === 'md') {
                        files.push(child);
                    } else if (child.children) {
                        processFolder(child);
                    }
                });
            }
        };

        processFolder(folder);
        return files;
    }

    /**
     * Get citation metadata from file
     */
    public async getCitationMetadata(file: TFile): Promise<CitationMetadata | null> {
        try {
            const content = await this.app.vault.read(file);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            
            if (!frontmatterMatch || !frontmatterMatch[1]) {
                return null;
            }

            const metadata = this.parseFrontmatter(frontmatterMatch[1]);
            return metadata as CitationMetadata;
        } catch (error) {
            console.error('Error reading citation metadata:', error);
            return null;
        }
    }

    /**
     * Find a citation by its URL (returns the first match or null)
     */
    public async findCitationByUrl(url: string): Promise<CitationMetadata | null> {
        const files = await this.getAllCitationFiles();
        for (const file of files) {
            const metadata = await this.getCitationMetadata(file);
            if (metadata && metadata.url === url) {
                return metadata;
            }
        }
        return null;
    }

    /**
     * Get the full citation text for a given hex ID
     */
    public async getCitationText(hexId: string): Promise<string | null> {
        try {
            const filename = `${hexId}.md`;
            const filepath = `${this.citationsFolder}/${filename}`;
            
            const file = this.app.vault.getAbstractFileByPath(filepath);
            if (!(file instanceof TFile)) {
                return null;
            }
            
            const metadata = await this.getCitationMetadata(file);
            
            if (!metadata) {
                return null;
            }
            
            // Assemble the citation text from metadata
            return this.assembleCitationText(metadata);
        } catch (error) {
            console.error('Error getting citation text:', error);
            return null;
        }
    }

    /**
     * Assemble citation text from metadata
     */
    public assembleCitationText(metadata: CitationMetadata): string {
        const parts: string[] = [];
        
        // Start with the title and URL in markdown link format
        if (metadata.title && metadata.url) {
            // Extract domain from URL for the link text
            let domain = '';
            try {
                const urlObj = new URL(metadata.url);
                domain = urlObj.hostname.replace('www.', '');
            } catch (e) {
                domain = 'Source';
            }
            
            parts.push(`"[${metadata.title} | ${domain}](${metadata.url})"`);
        } else if (metadata.url) {
            parts.push(`"${metadata.url}"`);
        }
        
        // Add additional context if available
        if (metadata.author) {
            parts.push(`by ${metadata.author}`);
        }
        
        if (metadata.date) {
            parts.push(metadata.date);
        }
        
        // Add source link if different from the main URL
        if (metadata.source && metadata.url) {
            try {
                const urlObj = new URL(metadata.url);
                const urlDomain = urlObj.hostname.replace('www.', '');
                if (metadata.source.toLowerCase() !== urlDomain.toLowerCase()) {
                    parts.push(`[${metadata.source}](https://${metadata.source})`);
                }
            } catch (e) {
                // If URL parsing fails, still add the source
                parts.push(`[${metadata.source}](https://${metadata.source})`);
            }
        }
        
        // Construct the final citation text
        const citationText = parts.join('. ');
        return `[^${metadata.hexId}]: ${citationText}.`;
    }
}

// Singleton instance - will be properly initialized in main.ts
export const citationFileService = new CitationFileService(null as any);

// Method to initialize the service with the app instance
export function initializeCitationFileService(app: App): void {
    (citationFileService as any).app = app;
} 