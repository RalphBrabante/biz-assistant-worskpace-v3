export interface ApiResponse<T> {
  code?: string;
  message?: string;
  ok?: boolean;
  data?: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface FieldConfig {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'checkbox' | 'json';
  required?: boolean;
  readonlyOnEdit?: boolean;
  placeholder?: string;
}

export interface CrudResourceConfig {
  title: string;
  endpoint: string;
  fields: FieldConfig[];
  summaryFields: string[];
  createDefaults?: Record<string, unknown>;
}
