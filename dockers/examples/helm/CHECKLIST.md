# Checklist

To reach quality goal, please complete this checklist, and remove this file when everything is done.
It's OK to commit and deliver while all points are not done, but keep this file to know what should be improved.

- Review and Update the Chart.yaml File
    - [ ] Check and update metadata including `name`, `version`, `appVersion`, `description`.
- Customize Values.yaml
    - [ ] Add/Change default values for configurations.
    - [ ] Set default resource limits (CPU, memory).
    - [ ] Update image repository and tag.
    - [ ] Configure environment variables and any service-specific settings.
    - [ ] Document values.yaml to support [readme-generator-for-helm](https://github.com/bitnami-labs/readme-generator-for-helm).
- Update the Templates
    - [ ] Remove unused templates in `templates/`.
    - [ ] Check that no sensitive endpoint is accessible.
    - [ ] Verify the service type and ports.
    - [ ] Add liveness and readiness probes in the deployment template.
    - [ ] Specify resource requests and limits in the deployment template to ensure efficient resource usage.
    - [ ] Make sure resources are properly annotated and labeled for better management and observability.
- Quality
    - [ ] Add Helm tests in `templates/tests/` to verify the chart's functionality.
    - [ ] Use `helm lint` to check for issues with the chart structure and syntax.
    - [ ] Create a README.md explaining the chart's purpose, configuration options, and any prerequisites.
    - [ ] Remove unnecessary comments (generated for templating purpose)
    - [ ] Customize `templates/NOTES.txt` to display useful information post-installation to devOps friends.
    - [ ] Review `LICENSE`.
- Test
    - [ ] Use `helm install --dry-run --debug` and/or `helm template .` to test the rendering of your templates.
    - [ ] Deploy the chart in a test environment to ensure it works as expected.
- Deliver
    - [ ] Use `helm package` locally to ensure that chart can be packaged.
    - [ ] Configure CI to build automatically the package.
