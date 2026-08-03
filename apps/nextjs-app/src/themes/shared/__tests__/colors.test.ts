import { tailwindV3Colors } from '../colors';
describe('colors', () => {
  describe('tailwindV3Colors', () => {
    it('should be defined', () => {
      expect(tailwindV3Colors).toBeDefined();
    });
    it('should contain current', () => {
      expect(tailwindV3Colors?.current).toBeDefined();
    });
    it("shouldn't contain deprecated colors", () => {
      expect(tailwindV3Colors?.warmGray).toBeUndefined();
    });
  });
});
