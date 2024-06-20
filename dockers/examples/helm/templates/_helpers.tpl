{{/* vim: set filetype=mustache: */}}

{{- define "teable.shared.image" -}}
{{- $ := (first .) }}
{{- $label := (index . 1) }}
{{- $root := (get $.Values $label) }}
securityContext:
  {{- toYaml $root.securityContext | nindent 2 }}
image: "{{ $root.image.repository | default $.Values.image.repository }}:{{ $root.image.tag | default $.Values.image.tag | default $.Chart.AppVersion }}"
imagePullPolicy: {{ $root.image.pullPolicy | default $.Values.image.pullPolicy }}
{{- end }}

{{- define "teable.nameBuilder" -}}
  {{- $fullName := include "common.fullname" . -}}
  {{- printf "%s-teable" $fullName -}}
{{- end }}

{{- define "common.nameBuilder" -}}
{{- prepend (rest .) (include "common.fullname" (first .)) | join "-" -}}
{{- end }}

{{- define "teable.secretName" -}}
{{- print "teable-secret" }}
{{- end }}
