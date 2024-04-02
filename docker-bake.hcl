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
  tags = ["${IMAGE_REGISTRY}/teableio/teable:latest", "${IMAGE_REGISTRY}/teableio/teable:${IMAGE_TAG}"]
}

target "teable-db-migrate" {
  context = "."
  dockerfile = "dockers/teable/Dockerfile.db-migrate"
  platforms = ["linux/amd64", "linux/arm64"]
  tags = ["${IMAGE_REGISTRY}/teableio/teable-db-migrate:latest", "${IMAGE_REGISTRY}/teableio/teable-db-migrate:${IMAGE_TAG}"]
}