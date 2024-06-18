{{- define "teable.env.backend" -}}
{{- $serviceName := include "teable.nameBuilder" . }}
- name: PUBLIC_ORIGIN
  value: {{.Values.config.origin | required "You should set `origin` to url where the app is available. Ex: https://teable.example.com" | quote}}
- name: BACKEND_JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $serviceName }}
      key: jwt-secret
- name: BACKEND_SESSION_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $serviceName }}
      key: session-secret
- name: BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $serviceName }}
      key: accessToken-encryption-key
- name: BACKEND_ACCESS_TOKEN_ENCRYPTION_IV
  valueFrom:
    secretKeyRef:
      name: {{ $serviceName }}
      key: accessToken-encryption-iv
{{- end -}}

{{- define "teable.env.database" -}}
{{- $serviceName := include "teable.nameBuilder" . }}
- name: POSTGRES_HOST
  value: {{ $serviceName }}-postgresql
- name: POSTGRES_PORT
  value: {{ .Values.postgresql.containerPorts.postgresql | quote }}
- name: POSTGRES_DB
  value: {{ .Values.postgresql.auth.database | quote }}
- name: POSTGRES_USER
  value: postgres
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ $serviceName }}
      key: {{ .Values.postgresql.auth.secretKeys.adminPasswordKey | quote }}
{{- end -}}

{{- define "teable.env.mail" -}}
{{- $serviceName := include "teable.nameBuilder" . }}
- name: BACKEND_MAIL_HOST
  valueFrom:
    configMapKeyRef:
      name: {{ $serviceName }}
      key: mail-host
      optional: true
- name: BACKEND_MAIL_PORT
  valueFrom:
    configMapKeyRef:
      name: {{ $serviceName }}
      key: mail-port
      optional: true
- name: BACKEND_MAIL_SECURE
  valueFrom:
    configMapKeyRef:
      name: {{ $serviceName }}
      key: mail-secure
      optional: true
- name: BACKEND_MAIL_SENDER
  valueFrom:
    configMapKeyRef:
      name: {{ $serviceName }}
      key: mail-sender
      optional: true
- name: BACKEND_MAIL_SENDER_NAME
  valueFrom:
    configMapKeyRef:
      name: {{ $serviceName }}
      key: mail-sender-name
      optional: true
- name: BACKEND_MAIL_AUTH_USER
  valueFrom:
    configMapKeyRef:
      name: {{ $serviceName }}
      key: mail-auth-username
      optional: true
- name: BACKEND_MAIL_AUTH_PASS
  valueFrom:
    secretKeyRef:
      name: {{ $serviceName }}
      key: mail-auth-password
      optional: true
{{- end -}}

{{- define "teable.env.storage" -}}
{{- $serviceName := include "teable.nameBuilder" . }}
- name: STORAGE_PREFIX
  valueFrom:
    configMapKeyRef:
      name: {{ $serviceName }}
      key: storage-origin
- name: BACKEND_STORAGE_PROVIDER
  valueFrom:
    configMapKeyRef:
      name: {{ $serviceName }}
      key: storage-provider
- name: BACKEND_STORAGE_PUBLIC_BUCKET
  value: {{ (split "," .Values.minio.defaultBuckets)._0 | trim }}
- name: BACKEND_STORAGE_PRIVATE_BUCKET
  value: {{ (split "," .Values.minio.defaultBuckets)._1 | trim }}
- name: BACKEND_STORAGE_MINIO_ENDPOINT
  value: {{ $serviceName }}-minio
- name: BACKEND_STORAGE_MINIO_PORT
  value: {{ .Values.minio.containerPorts.api | quote }}
- name: BACKEND_STORAGE_MINIO_USE_SSL
  valueFrom:
    configMapKeyRef:
      name: {{ $serviceName }}
      key: storage-minio-useSSL
      optional: true
- name: BACKEND_STORAGE_MINIO_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $serviceName }}
      key: root-user
- name: BACKEND_STORAGE_MINIO_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $serviceName }}
      key: root-password
{{- end -}}
