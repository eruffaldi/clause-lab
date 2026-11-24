IMAGE_NAME = clause-lab
BUILD_DIR = dist

.PHONY: all dev test build analyze clean version bump example

all: build

test:
	docker build --target test -t $(IMAGE_NAME):test .

dev:
	docker build --target dev -t $(IMAGE_NAME):dev .
	docker run --rm -it -v $(PWD)/src:/app/src -p 3000:3000 $(IMAGE_NAME):dev

build: test
	@mkdir -p $(BUILD_DIR)
	docker build --target builder -t $(IMAGE_NAME):build .
	docker run --rm -v $(PWD)/$(BUILD_DIR):/app/dist $(IMAGE_NAME):build npm run package

# Offline index generation: make analyze PDF=path/to/standard.pdf
analyze:
	docker build --target base -t $(IMAGE_NAME):base .
	docker run --rm -v "$(abspath $(dir $(PDF)))":/data $(IMAGE_NAME):base npm run analyze -- "/data/$(notdir $(PDF))" "/data/$(basename $(notdir $(PDF))).clause-index.json"

clean:
	rm -rf $(BUILD_DIR) node_modules scripts/.bundle.mjs scripts/.analyze.mjs
	docker rmi -f $(IMAGE_NAME):test $(IMAGE_NAME):build $(IMAGE_NAME):dev $(IMAGE_NAME):base 2>/dev/null || true

version:
	@node -p "require('./package.json').version" 2>/dev/null || grep '"version"' package.json

# make bump PART=patch|minor|major  (runs npm inside the container; no git tag)
bump:
	docker run --rm -v $(PWD):/app -w /app node:20-alpine npm version $(or $(PART),patch) --no-git-tag-version

# Regenerate the synthetic example PDF and its committed index (after analyzer changes)
example:
	docker build --target base -t $(IMAGE_NAME):base .
	docker run --rm -v $(PWD)/examples:/app/examples $(IMAGE_NAME):base npm run example
