import api from './client';

export const listJobs = () => api.get('/replicate/jobs').then(r => r.data);

export const getJob = (id) => api.get(`/replicate/jobs/${id}`).then(r => r.data);

export const createJob = (formData) =>
  api.post('/replicate/jobs', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 5 * 60 * 1000,
  }).then(r => r.data);

export const submitLLMOutput = (id, llmOutput) =>
  api.post(`/replicate/jobs/${id}/llm-output`, { llm_output: llmOutput }).then(r => r.data);

export const listGUs = (id) => api.get(`/replicate/jobs/${id}/gus`).then(r => r.data);

export const generateImage = (id, guId, payload = {}) =>
  api.post(`/replicate/jobs/${id}/gus/${guId}/generate-image`, payload).then(r => r.data);

export const generateVideo = (id, guId, payload = {}) =>
  api.post(`/replicate/jobs/${id}/gus/${guId}/generate-video`, payload).then(r => r.data);

export const deleteJob = (id) => api.delete(`/replicate/jobs/${id}`).then(r => r.data);
