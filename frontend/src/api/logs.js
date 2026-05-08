import api from './client';

export const fetchLogs = (params = {}) => api.get('/logs', { params }).then(r => r.data);
export const fetchLogDetail = (id) => api.get(`/logs/${id}`).then(r => r.data);
export const fetchHoloBalance = () => api.get('/logs/balance').then(r => r.data);
export const fetchHoloTransactions = (params = {}) => api.get('/logs/transactions', { params }).then(r => r.data);
export const fetchProvidersSummary = () => api.get('/logs/providers').then(r => r.data);
