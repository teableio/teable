{{/* vim: set filetype=mustache: */}}

{{- define "common.secret.dockerconfigjson.data" }}
{{- printf "{\"auths\":{\"%s\":{\"username\":\"%s\",\"password\":\"%s\",\"auth\":\"%s\"}}}" .registry .username .password (printf "%s:%s" .username .password | b64enc) | b64enc }}
{{- end }}

{{/*
Usage : {{ include "common.secret.dockerconfigjson.name" (dict "fullname" (include "teable.nameBuilder" .) "imageCredentials" .Values.path.to.the.image1) }}
*/}}
{{- define "common.secret.dockerconfigjson.name" }}
{{- if (default (dict) .imageCredentials).name }}{{ .imageCredentials.name }}{{ else }}{{ .fullname | trunc 63 | trimSuffix "-" }}-dockerconfig{{ end -}}
{{- end }}

{{/*
Usage : {{ include "common.secret.dockerconfigjson" (dict "fullname" (include "teable.nameBuilder" .) "imageCredentials" .Values.path.to.the.image1) }}
*/}}
{{- define "common.secret.dockerconfigjson" }}
{{- if .imageCredentials -}}
apiVersion: v1
kind: Secret
metadata:
  name: {{ template "common.secret.dockerconfigjson.name" (dict "fullname" .fullname "imageCredentials" .imageCredentials) }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: {{ template "common.secret.dockerconfigjson.data" .imageCredentials }}
{{- end -}}
{{- end }}
