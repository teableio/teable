{{- define "teable.env.shared" -}}
- name: TZ
  value: {{ .Values.timezone | required "You should set `timezone`. Ex: Europe/Paris" | quote }}
- name: PRISMA_DATABASE_URL
  value: {{ include "teable.prisma_url" . | quote }}
{{- end -}}

{{- define "teable.env.backend" -}}
- name: NODE_OPTIONS
  value: "--max-old-space-size=1024"
- name: PUBLIC_ORIGIN
  value: {{.Values.origin | required "You should set `origin` to url where the app is available. Ex: https://teable.example.com" | quote}}
- name: BACKEND_JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: jwt-secret
- name: BACKEND_SESSION_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: session-secret
- name: SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: secretKey
- name: BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: accessToken-encryption-key
- name: BACKEND_ACCESS_TOKEN_ENCRYPTION_IV
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: accessToken-encryption-iv
{{- end -}}

{{- define "teable.env.mail" -}}
- name: BACKEND_MAIL_HOST
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: mail-host
- name: BACKEND_MAIL_PORT
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: mail-port
- name: BACKEND_MAIL_SECURE
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: mail-secure
- name: BACKEND_MAIL_SENDER
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: mail-sender
- name: BACKEND_MAIL_SENDER_NAME
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: mail-sender-name
- name: BACKEND_MAIL_AUTH_USER
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: mail-auth-username
- name: BACKEND_MAIL_AUTH_PASS
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: mail-auth-password
{{- end -}}

{{- define "teable.env.storage" -}}
- name: BACKEND_STORAGE_PROVIDER
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: storage-provider
- name: BACKEND_STORAGE_PUBLIC_BUCKET
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: storage-publicBucket
- name: BACKEND_STORAGE_PRIVATE_BUCKET
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: storage-privateBucket
- name: BACKEND_STORAGE_MINIO_ENDPOINT
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: storage-minio-endPoint
- name: BACKEND_STORAGE_MINIO_PORT
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: storage-minio-port
- name: BACKEND_STORAGE_MINIO_USE_SSL
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: storage-minio-useSSL
- name: BACKEND_STORAGE_MINIO_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: storage-minio-accessKey
- name: BACKEND_STORAGE_MINIO_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "teable.nameBuilder" (list $ "backend") }}
      key: storage-minio-secretKey
{{- end -}}

{{- define "teable.dictToQueryString" -}}
    {{- if (eq (typeOf .) "string") -}}
        {{- . -}}
    {{- else -}}
        {{- $first := true -}}
        {{ range $key, $value := . -}}
          {{- if $first -}}
            {{- $first = false -}}
          {{- else -}}
            &
          {{- end -}}
          {{- $key | urlquery }}={{ $value | urlquery -}}
        {{- end -}}
    {{- end -}}
{{- end -}}

{{- define "teable.safe_url" -}}
{{- urlJoin (
    dict
        "scheme" .scheme
        "userinfo" (printf "%s:%s" (urlquery .username)  (urlquery .password) )
        "host" (printf "%s:%s" .host (.port | print))
        "path" (printf "/%s" .path)
        "query" (include "teable.dictToQueryString" (.query | default (dict)))
        "fragment" (urlquery .fragment)
    )
-}}
{{- end -}}


{{- define "teable.prisma_url" -}}
{{- include "teable.safe_url" (
    dict
        "scheme" "postgresql"
        "username" .Values.database.username
        "password" .Values.database.password
        "host" .Values.database.host
        "port" .Values.database.port
        "path" .Values.database.name
        "query" .Values.database.extraArgs
    )
-}}
{{- end -}}
