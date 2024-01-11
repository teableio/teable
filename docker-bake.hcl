group "default" {
  targets = ["teable"]
}

variable "IMAGE_REGISTRY" {
  default = "docker.io"
}

variable "IMAGE_TAG" {
  default = "latest"
}

target "teable" {
  context = "."
  dockerfile = "dockers/teable/Dockerfile"
  platforms = ["linux/amd64", "linux/arm64"]
  tags = ["${IMAGE_REGISTRY}/teablecloud/teable:latest", "${IMAGE_REGISTRY}/teablecloud/teable:${IMAGE_TAG}"]
}