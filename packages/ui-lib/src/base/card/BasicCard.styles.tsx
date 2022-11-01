import styled from '@emotion/styled';

export const Ctn = styled.div`
  background-color: white;
  border-radius: 0.25rem;
  max-width: 300px;
  box-shadow: 0 0 #0000, 0 0 #0000, 0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  &:hover {
    .card__image {
      filter: contrast(100%);
    }
  }
  img {
    max-height: 200px;
    object-fit: cover;
    object-position: top;
  }
  .container {
    padding: 15px;
  }
`;
