import { App, TFile, TFolder, Notice } from 'obsidian';
import { asNumber, asString, asStringArray, isRecord } from '../utils/coerce';
import type { CitationData } from './urlCitationService';

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
    private _app: App | null = null;
    private citationsFolder: string = 'Citations';

    private get app(): App {
        if (!this._app) {
            throw new Error('CitationFileService not initialized — call initializeCitationFileService(app) first');
        }
        return this._app;
    }

    public setApp(app: App): void {
        this._app = app;
    }

    public setCitationsFolder(folderPath: string): void {
        this.citationsFolder = folderPath;
    }

    public getCitationsFolder(): string {
        return this.citationsFolder;
    }

    /**
     * Create a citation file with citation data directly from the Jina.ai Reader API.
     */
    public async createCitationFileWithData(
        hexId: string,
        citationData: CitationData,
        sourceFile?: string
    ): Promise<TFile | null> {
        try {
            await this.ensureCitationsFolder();
            const filepath = `${this.citationsFolder}/${hexId}.md`;

            const existing = this.app.vault.getAbstractFileByPath(filepath);
            if (existing instanceof TFile) {
                await this.app.vault.delete(existing);
            }

            const metadata = this.metadataFromCitationData(hexId, citationData, sourceFile);
            const file = await this.app.vault.create(filepath, this.buildBodyContent(metadata));
            await this.writeFrontmatter(file, metadata);

            new Notice(`Citation file created: ${hexId}.md`);
            return file;
        } catch (error) {
            console.error('Error creating citation file:', error);
            new Notice(`Error creating citation file: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Create a citation file from a free-form reference text + optional URL.
     */
    public async createCitationFile(
        hexId: string,
        referenceText?: string,
        url?: string,
        sourceFile?: string
    ): Promise<TFile | null> {
        try {
            await this.ensureCitationsFolder();
            const filepath = `${this.citationsFolder}/${hexId}.md`;

            const existing = this.app.vault.getAbstractFileByPath(filepath);
            if (existing instanceof TFile) {
                await this.updateCitationUsage(existing, sourceFile);
                return existing;
            }

            const extracted = this.extractMetadataFromReference(referenceText, url);
            const metadata = this.metadataFromExtracted(hexId, extracted, sourceFile);
            const file = await this.app.vault.create(filepath, this.buildBodyContent(metadata, referenceText));
            await this.writeFrontmatter(file, metadata);

            new Notice(`Citation file created: ${hexId}.md`);
            return file;
        } catch (error) {
            console.error('Error creating citation file:', error);
            new Notice(`Error creating citation file: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Increment usage count and append the source file to filesUsedIn.
     * Atomic via Obsidian's processFrontMatter API; no manual YAML emission.
     */
    public async updateCitationUsage(citationFile: TFile, sourceFile?: string): Promise<void> {
        try {
            await this.app.fileManager.processFrontMatter(citationFile, (fm: Record<string, unknown>) => {
                fm['usageCount'] = (asNumber(fm['usageCount']) ?? 0) + 1;
                fm['lastModified'] = new Date().toISOString();
                if (sourceFile) {
                    const files = asStringArray(fm['filesUsedIn']);
                    if (!files.includes(sourceFile)) files.push(sourceFile);
                    fm['filesUsedIn'] = files;
                }
            });
        } catch (error) {
            console.error('Error updating citation usage:', error);
        }
    }

    /**
     * Read citation metadata via Obsidian's metadata cache, coercing each
     * field through the boundary helpers so inconsistent shapes from
     * hand-edited frontmatter don't crash the plugin.
     */
    public getCitationMetadata(file: TFile): CitationMetadata | null {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache || !isRecord(cache.frontmatter)) return null;
        const fm = cache.frontmatter;
        const hexId = asString(fm['hexId']);
        if (!hexId) return null;
        const now = new Date().toISOString();
        return {
            hexId,
            title: asString(fm['title']),
            author: asString(fm['author']),
            url: asString(fm['url']),
            date: asString(fm['date']),
            source: asString(fm['source']),
            tags: asStringArray(fm['tags']),
            created: asString(fm['created']) ?? now,
            lastModified: asString(fm['lastModified']) ?? now,
            referenceText: asString(fm['referenceText']),
            usageCount: asNumber(fm['usageCount']) ?? 0,
            filesUsedIn: asStringArray(fm['filesUsedIn']),
        };
    }

    /**
     * Find the first citation whose `url` field matches the given URL.
     */
    public findCitationByUrl(url: string): CitationMetadata | null {
        for (const file of this.getAllCitationFiles()) {
            const metadata = this.getCitationMetadata(file);
            if (metadata && metadata.url === url) return metadata;
        }
        return null;
    }

    /**
     * Get the assembled footnote-formatted citation text for a hex ID.
     */
    public getCitationText(hexId: string): string | null {
        const file = this.app.vault.getAbstractFileByPath(`${this.citationsFolder}/${hexId}.md`);
        if (!(file instanceof TFile)) return null;
        const metadata = this.getCitationMetadata(file);
        return metadata ? this.assembleCitationText(metadata) : null;
    }

    /**
     * List all markdown citation files under the citations folder, recursively.
     */
    public getAllCitationFiles(): TFile[] {
        const folder = this.app.vault.getAbstractFileByPath(this.citationsFolder);
        if (!(folder instanceof TFolder)) return [];
        const files: TFile[] = [];
        const walk = (current: TFolder): void => {
            for (const child of current.children) {
                if (child instanceof TFile && child.extension === 'md') {
                    files.push(child);
                } else if (child instanceof TFolder) {
                    walk(child);
                }
            }
        };
        walk(folder);
        return files;
    }

    /**
     * Compose the footnote-formatted citation text from metadata.
     */
    public assembleCitationText(metadata: CitationMetadata): string {
        const parts: string[] = [];

        if (metadata.title && metadata.url) {
            const domain = this.safeHostname(metadata.url) ?? 'Source';
            parts.push(`"[${metadata.title} | ${domain}](${metadata.url})"`);
        } else if (metadata.url) {
            parts.push(`"${metadata.url}"`);
        }

        if (metadata.author) parts.push(`by ${metadata.author}`);
        if (metadata.date) parts.push(metadata.date);

        if (metadata.source && metadata.url) {
            const urlDomain = this.safeHostname(metadata.url);
            if (!urlDomain || metadata.source.toLowerCase() !== urlDomain.toLowerCase()) {
                parts.push(`[${metadata.source}](https://${metadata.source})`);
            }
        }

        return `[^${metadata.hexId}]: ${parts.join('. ')}.`;
    }

    private async writeFrontmatter(file: TFile, metadata: CitationMetadata): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm['hexId'] = metadata.hexId;
            fm['title'] = metadata.title ?? '';
            fm['author'] = metadata.author ?? '';
            fm['url'] = metadata.url ?? '';
            fm['date'] = metadata.date ?? '';
            fm['source'] = metadata.source ?? '';
            fm['tags'] = metadata.tags;
            fm['created'] = metadata.created;
            fm['lastModified'] = metadata.lastModified;
            fm['referenceText'] = metadata.referenceText ?? '';
            fm['usageCount'] = metadata.usageCount;
            fm['filesUsedIn'] = metadata.filesUsedIn;
        });
    }

    private metadataFromCitationData(
        hexId: string,
        citationData: CitationData,
        sourceFile: string | undefined
    ): CitationMetadata {
        const now = new Date().toISOString();
        return {
            hexId,
            title: citationData.title || undefined,
            author: citationData.author,
            url: citationData.url || undefined,
            date: citationData.date,
            source: citationData.siteName,
            tags: [],
            created: now,
            lastModified: now,
            referenceText: undefined,
            usageCount: 1,
            filesUsedIn: sourceFile ? [sourceFile] : [],
        };
    }

    private metadataFromExtracted(
        hexId: string,
        extracted: Partial<CitationMetadata>,
        sourceFile: string | undefined
    ): CitationMetadata {
        const now = new Date().toISOString();
        return {
            hexId,
            title: extracted.title,
            author: extracted.author,
            url: extracted.url,
            date: extracted.date,
            source: extracted.source,
            tags: extracted.tags ?? [],
            created: now,
            lastModified: now,
            referenceText: extracted.referenceText,
            usageCount: 1,
            filesUsedIn: sourceFile ? [sourceFile] : [],
        };
    }

    private extractMetadataFromReference(
        referenceText?: string,
        url?: string
    ): Partial<CitationMetadata> {
        const metadata: Partial<CitationMetadata> = {};

        if (url) {
            metadata.url = url;
            const hostname = this.safeHostname(url);
            if (hostname) metadata.source = hostname;
        }

        if (referenceText) {
            const titleMatch = referenceText.match(/\[([^\]^]+)\]\s*\(https?:\/\/[^\s]+\)/);
            if (titleMatch && titleMatch[1]) metadata.title = titleMatch[1];

            const authorPatterns = [
                /by\s+([^,\.]+)/i,
                /author[:\s]+([^,\.]+)/i,
                /written\s+by\s+([^,\.]+)/i,
            ];
            for (const pattern of authorPatterns) {
                const match = referenceText.match(pattern);
                if (match && match[1]) {
                    metadata.author = match[1].trim();
                    break;
                }
            }

            const datePatterns = [
                /(\d{4})/,
                /(\d{1,2}\/\d{1,2}\/\d{4})/,
                /(\d{1,2}-\d{1,2}-\d{4})/,
            ];
            for (const pattern of datePatterns) {
                const match = referenceText.match(pattern);
                if (match && match[1]) {
                    metadata.date = match[1];
                    break;
                }
            }
        }

        return metadata;
    }

    private buildBodyContent(metadata: CitationMetadata, referenceText?: string): string {
        let content = '';
        if (referenceText) {
            content += `# ${metadata.title || 'Citation'}\n\n`;
            content += `## Reference\n\n${referenceText}\n\n`;
        } else {
            content += `# Citation ${metadata.hexId}\n\n`;
        }
        content += `## Usage\n\nThis citation has been used ${metadata.usageCount} time(s).\n\n`;
        if (metadata.url) {
            content += `## Source\n\n[${metadata.url}](${metadata.url})\n\n`;
        }
        content += `## Notes\n\nAdd your notes about this citation here.\n\n`;
        return content;
    }

    private safeHostname(url: string): string | undefined {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch {
            return undefined;
        }
    }

    private async ensureCitationsFolder(): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(this.citationsFolder);
        if (!folder) {
            await this.app.vault.createFolder(this.citationsFolder);
        }
    }
}

export const citationFileService = new CitationFileService();

export function initializeCitationFileService(app: App): void {
    citationFileService.setApp(app);
}
