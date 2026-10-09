FROM nginx:1.27-alpine
# адрес API подставляется при старте (шаблоны nginx-образа + envsubst): compose — http://api:8000, k8s — свой
ENV GEOVIS_API_UPSTREAM=http://api:8000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY web/dist /usr/share/nginx/html
