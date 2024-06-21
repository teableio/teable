{{- define "teable.env.backend" -}}
{{- $teable := include "teable.nameBuilder" . -}}
{{- $secret := include "teable.secretName" . -}}
- name: PUBLIC_ORIGIN
  value: "{{- if .Values.ingress.tls -}}https{{- else -}}http{{- end }}://{{ .Values.ingress.hostname }}"
- name: BACKEND_JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: jwt-secret
- name: BACKEND_SESSION_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: session-secret
- name: BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: accessToken-encryption-key
- name: BACKEND_ACCESS_TOKEN_ENCRYPTION_IV
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: accessToken-encryption-iv
- name: BACKEND_CACHE_PROVIDER
  value: redis
- name: BACKEND_CACHE_REDIS_URI
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: redis-url
{{- end -}}

{{- define "teable.env.database" -}}
{{- $secret := include "teable.secretName" . -}}
{{- $postgres:= include "common.nameBuilder" (list $ "postgresql") }}
- name: PRISMA_DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: database-url
{{- if .Values.postgresql.primary.service.nodePorts.postgresql }}
- name: PUBLIC_DATABASE_PROXY
  value: "{{ .Values.ingress.hostname }}:{{ (toString .Values.postgresql.primary.service.nodePorts.postgresql) }}"
{{- end }}
{{- end -}}

{{- define "teable.env.mail" -}}
{{- $teable := include "teable.nameBuilder" . }}
{{- $secret := include "teable.secretName" . -}}
- name: BACKEND_MAIL_HOST
  valueFrom:
    configMapKeyRef:
      name: {{ $teable }}
      key: mail-host
      optional: true
- name: BACKEND_MAIL_PORT
  valueFrom:
    configMapKeyRef:
      name: {{ $teable }}
      key: mail-port
      optional: true
- name: BACKEND_MAIL_SECURE
  valueFrom:
    configMapKeyRef:
      name: {{ $teable }}
      key: mail-secure
      optional: true
- name: BACKEND_MAIL_SENDER
  valueFrom:
    configMapKeyRef:
      name: {{ $teable }}
      key: mail-sender
      optional: true
- name: BACKEND_MAIL_SENDER_NAME
  valueFrom:
    configMapKeyRef:
      name: {{ $teable }}
      key: mail-sender-name
      optional: true
- name: BACKEND_MAIL_AUTH_USER
  valueFrom:
    configMapKeyRef:
      name: {{ $teable }}
      key: mail-auth-username
      optional: true
- name: BACKEND_MAIL_AUTH_PASS
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: mail-auth-password
      optional: true
{{- end -}}

{{- define "teable.env.storage" -}}
{{- $teable := include "teable.nameBuilder" . }}
{{- $secret := include "teable.secretName" . -}}
{{- $minio:= include "common.nameBuilder" (list $ "minio") }}
- name: STORAGE_PREFIX
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: minio-url
- name: BACKEND_STORAGE_PROVIDER
  valueFrom:
    configMapKeyRef:
      name: {{ $teable }}
      key: storage-provider
- name: BACKEND_STORAGE_PUBLIC_BUCKET
  value: {{ index .Values.minio.provisioning.buckets 0 "name" }}
- name: BACKEND_STORAGE_PRIVATE_BUCKET
  value: {{ index .Values.minio.provisioning.buckets 1 "name" }}
- name: BACKEND_STORAGE_MINIO_ENDPOINT
  value: {{ .Values.minio.apiIngress.hostname | quote }}
- name: BACKEND_STORAGE_MINIO_PORT
  value: {{ .Values.minio.apiIngress.tls | ternary "443" "80" | quote }}
- name: BACKEND_STORAGE_MINIO_USE_SSL
  value: {{ .Values.minio.apiIngress.tls | quote }}
- name: BACKEND_STORAGE_MINIO_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: minio-user
- name: BACKEND_STORAGE_MINIO_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: minio-password
{{- end -}}
