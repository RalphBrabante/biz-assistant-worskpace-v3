import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse } from './types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly bypassSwHeaders = new HttpHeaders({ 'ngsw-bypass': 'true' });

  constructor(private readonly http: HttpClient) {}

  list<T>(endpoint: string): Observable<ApiResponse<T[]>> {
    return this.http.get<ApiResponse<T[]>>(endpoint);
  }

  create<T>(endpoint: string, payload: Record<string, unknown>): Observable<ApiResponse<T>> {
    return this.http.post<ApiResponse<T>>(endpoint, payload);
  }

  createFormData<T>(endpoint: string, payload: FormData): Observable<ApiResponse<T>> {
    return this.http.post<ApiResponse<T>>(endpoint, payload, {
      headers: this.bypassSwHeaders,
    });
  }

  update<T>(endpoint: string, id: string, payload: Record<string, unknown>): Observable<ApiResponse<T>> {
    return this.http.put<ApiResponse<T>>(`${endpoint}/${id}`, payload);
  }

  remove(endpoint: string, id: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${endpoint}/${id}`);
  }

  get<T>(endpoint: string): Observable<ApiResponse<T>> {
    return this.http.get<ApiResponse<T>>(endpoint);
  }

  put<T>(endpoint: string, payload: Record<string, unknown>): Observable<ApiResponse<T>> {
    return this.http.put<ApiResponse<T>>(endpoint, payload);
  }

  putFormData<T>(endpoint: string, payload: FormData): Observable<ApiResponse<T>> {
    return this.http.put<ApiResponse<T>>(endpoint, payload, {
      headers: this.bypassSwHeaders,
    });
  }

  download(endpoint: string): Observable<Blob> {
    return this.http.get(endpoint, { responseType: 'blob' });
  }
}
