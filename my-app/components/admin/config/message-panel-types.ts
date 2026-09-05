import type { MessageBodyEditorMode } from './MessageBodyEditor';

export interface TemplateVariable {
  name: string;
  description: string;
}

export interface MessageTemplate {
  key: string;
  label: string;
  category: string;
  body: string;
  subject: string | null;
  subjectOnly: boolean;
  variables: TemplateVariable[];
  customized: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  css: string;
  publishedBody: string;
  publishedSubject: string | null;
  publishedCss: string;
  draftVersion: number | null;
  draftUpdatedAt: string | null;
  publishedVersion: number | null;
}

export interface PreviewContent {
  subject: string;
  html: string;
  text?: string;
  diagnostics?: string[];
}

export interface MessageRevision {
  id: string;
  templateKey: string;
  version: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type PreviewMode = 'draft' | 'saved' | 'default';
export type AuthorMode = MessageBodyEditorMode | 'html' | 'css';
export type PreviewSurface = 'desktop' | 'mobile' | 'text' | 'source';
export type PanelMessage = { type: 'success' | 'error'; text: string };
